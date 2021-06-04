import EventEmitter from 'eventemitter3';
import { logger } from 'xgplayer-helper-utils';
import { XGDataView, AudioTrackMeta, VideoTrackMeta, AudioSample, VideoSample } from 'xgplayer-helper-models'
import { ADTS, avc, hevc } from 'xgplayer-helper-codec';

/**
 * @typedef {import('xgplayer-helper-models').TsFrag } TsFrag
 */
/**
 * @typedef {import('xgplayer-helper-models').Buffer } Buffer
 */
const { NalUnit } = avc;
const { NalUnitHEVC } = hevc;
const StreamType = {
  0x01: ['video', 'MPEG-1'],
  0x02: ['video', 'MPEG-2'],
  0x1b: ['video', 'AVC.H264'],
  0x24: ['video', 'HVC.H265'],
  0xea: ['video', 'VC-1'],
  0x03: ['audio', 'MPEG-1'],
  0x04: ['audio', 'MPEG-2'],
  0x0f: ['audio', 'MPEG-2.AAC'],
  0x11: ['audio', 'MPEG-4.AAC'],
  0x80: ['audio', 'LPCM'],
  0x81: ['audio', 'AC3'],
  0x06: ['audio', 'AC3'],
  0x82: ['audio', 'DTS'],
  0x83: ['audio', 'Dolby TrueHD'],
  0x84: ['audio', 'AC3-Plus'],
  0x85: ['audio', 'DTS-HD'],
  0x86: ['audio', 'DTS-MA'],
  0xa1: ['audio', 'AC3-Plus-SEC'],
  0xa2: ['audio', 'DTS-HD-SEC']
};

class TsDemuxer extends EventEmitter {
  static get EVENTS () {
    return {
      DEMUX_COMPLETE: 'DEMUX_COMPLETE',
      METADATA_PARSED: 'METADATA_PARSED',
      VIDEO_SAMPLE_PARSED: 'VIDEO_SAMPLE_PARSED',
      AUDIO_SAMPLE_PARSED: 'AUDIO_SAMPLES_PARSED',
      SEI_PARSED: 'SEI_PARSED'
    }
  }

  /**
   * @param {any} videoTrack
   * @param {any} audioTrack
   */
  constructor ({ videoTrack, audioTrack }) {
    super();
    this.demuxing = false;
    this.videoTrack = videoTrack;
    this.audioTrack = audioTrack;
    this.pat = [];
    this.pmt = [];
    this._hasVideoMeta = false;
    this._hasAudioMeta = false;
    this.gopId = 0;
  }

  /**
   *
   * @param {TsFrag} frag ts fragment parsed from m3u8
   * @param {Buffer} buffer u8a-buffer
   * @param {boolean} isVod is a vod m3u8
   */
  demux (frag, buffer, isVod) {
    if (frag) {
      logger.log(this.TAG, `do demux: id=${frag.id},demuxing=${this.demuxing}`);
    }
    if (this.demuxing) {
      return;
    }

    let frags = {pat: [], pmt: []};
    let peses = {};
    while (buffer.length >= 188) {
      if (buffer.length >= 1 && buffer.array[0][buffer.offset] !== 71) {
        throw new Error(`Untrust sync code: ${buffer.array[0][buffer.offset]}, try to recover;`);
      }
      while (buffer.length >= 1 && buffer.array[0][buffer.offset] !== 71) {
        buffer.shift(1);
      }
      if (buffer.length < 188) {
        continue;
      }
      let buf = buffer.shift(188);
      // console.log(buf);
      let tsStream = new XGDataView(buf.buffer);
      let ts = {};
      TsDemuxer.read(tsStream, ts, frags);
      let pes = peses[ts.header.pid];
      if (ts.pes) {
        ts.pes.codec = ts.header.codec;
        ts.pes.streamType = ts.header.streamType;
        if (!peses[ts.header.pid]) {
          peses[ts.header.pid] = [];
        }
        peses[ts.header.pid].push(ts.pes);
        ts.pes.ES.buffer = [ts.pes.ES.buffer];
      } else if (pes) {
        pes[pes.length - 1].ES.buffer.push(ts.payload.stream);
      }
    }

    let AudioOptions = Object.assign({}, frag);
    let VideoOptions = Object.assign({}, frag);

    let noAudio = isVod && this._hasVideoMeta && !this._hasAudioMeta;
    let noVideo = isVod && this._hasAudioMeta && !this._hasVideoMeta;

    // Get Frames data
    for (let i = 0; i < Object.keys(peses).length; i++) {
      let epeses = peses[Object.keys(peses)[i]];
      for (let j = 0; j < epeses.length; j++) {
        let cPes = epeses[j];
        cPes.id = Object.keys(peses)[i];

        // 1. !noAudio 首片无音频,后续分片当无音频处理
        // 2. cPes.streamType === 0x0f || cPes.streamType === 0x11 只处理aac,其他音频格式当无音频
        let isAAC = cPes.streamType === 0x0f || cPes.streamType === 0x11;
        if (cPes.type === 'audio' && !noAudio && isAAC) {
          cPes.ES.buffer = TsDemuxer.mergeAudioES(cPes.ES.buffer);
          this.pushAudioSample(cPes, AudioOptions);
          AudioOptions = {};
        } else if (cPes.type === 'video' && !noVideo) {
          cPes.ES.buffer = TsDemuxer.mergeVideoES(cPes.ES.buffer);
          if (cPes.codec === 'HVC.H265') {
            this.pushVideoSampleHEVC(epeses[j], VideoOptions);
          } else {
            this.pushVideoSample(epeses[j], VideoOptions);
          }
          VideoOptions = {};
        }
      }
    }
  }

  pushAudioSample (pes, options) {
    const meta = new AudioTrackMeta({
      audioSampleRate: pes.ES.frequence,
      sampleRate: pes.ES.frequence,
      channelCount: pes.ES.channel,
      codec: 'mp4a.40.' + pes.ES.audioObjectType,
      originCodec: 'mp4a.40.' + pes.ES.originAudioObjectType,
      originObjectType: pes.ES.originAudioObjectType,
      config: pes.ES.audioConfig,
      id: 2,
      sampleRateIndex: pes.ES.frequencyIndex
    });
    meta.refSampleDuration = Math.floor(1024 / meta.audioSampleRate * meta.timescale);

    let metaEqual = TsDemuxer.compareMeta(this.audioTrack.meta, meta, true);

    if (!this._hasAudioMeta || !metaEqual) {
      this._hasAudioMeta = true;
      if (options) {
        options.meta = Object.assign({}, meta);
      } else {
        options = {
          meta: Object.assign({}, meta)
        };
      }
      this.emit(TsDemuxer.EVENTS.METADATA_PARSED, 'audio', meta);
    }

    let frameIndex = 0;
    pes.ES.buffer.skip(pes.pesHeaderLength + 9);
    let streamChanged = false;
    while (pes.ES.buffer.position < pes.ES.buffer.length) {
      if (ADTS.isHeader(new Uint8Array(pes.ES.buffer.buffer), pes.ES.buffer.position) && (pes.ES.buffer.position + 5) < pes.ES.buffer.length) {
        let frame = ADTS.appendFrame(this.audioTrack.meta.sampleRate, new Uint8Array(pes.ES.buffer.buffer), pes.ES.buffer.position, pes.pts, frameIndex);
        if (frame && frame.sample) {
          // logger.log(`${Math.round(frame.sample.pts)} : AAC`);
          pes.ES.buffer.skip(frame.length);
          const sample = new AudioSample({
            dts: frame.sample.dts,
            pts: frame.sample.pts,
            data: frame.sample.unit,
            options: streamChanged ? {} : options
          });
          if (options.meta) {
            streamChanged = true;
          }
          sample.dts = sample.pts = Math.ceil(sample.pts / 90);
          this.emit(TsDemuxer.EVENTS.AUDIO_SAMPLE_PARSED, sample);
          frameIndex++;
        } else {
          // logger.log('Unable to parse AAC frame');
          break;
        }
      } else {
        // nothing found, keep looking
        pes.ES.buffer.skip(1);
      }
    }
  }

  pushVideoSample (pes, options) {
    let nals = NalUnit.getNalunits(pes.ES.buffer);
    let meta = new VideoTrackMeta();

    let sampleLength = 0;
    let sps = false;
    let pps = false;
    let seiList = [];
    for (let i = 0; i < nals.length; i++) {
      let nal = nals[i];
      if (nal.sps) {
        sps = nal;
        meta.sps = nal.body;
        meta.chromaFormat = sps.sps.chroma_format;
        meta.codec = 'avc1.';
        for (var j = 1; j < 4; j++) {
          var h = sps.body[j].toString(16);
          if (h.length < 2) {
            h = '0' + h;
          }
          meta.codec += h;
        }
        meta.codecHeight = sps.sps.codec_size.height;
        meta.codecWidth = sps.sps.codec_size.width;
        meta.frameRate = sps.sps.frame_rate;
        meta.id = 1;
        meta.level = sps.sps.level_string;
        meta.presentHeight = sps.sps.present_size.height;
        meta.presentWidth = sps.sps.present_size.width;
        meta.profile = sps.sps.profile_string;
        meta.refSampleDuration = Math.floor(meta.timescale * (sps.sps.frame_rate.fps_den / sps.sps.frame_rate.fps_num));
        meta.sarRatio = sps.sps.sar_ratio ? sps.sps.sar_ratio : sps.sps.par_ratio;
      } else if (nal.pps) {
        meta.pps = nal.body;
        pps = nal;
      } else if (nal.sei) {
        seiList.push(nal.sei);
      } else if (nal.type < 9) {
        sampleLength += (4 + nal.body.byteLength);
      }
    }

    if (sps && pps) {
      meta.avcc = NalUnit.getAvcc(sps.body, pps.body);
      let metaEqual = TsDemuxer.compareMeta(this.videoTrack.meta, meta, true);
      if (!this._hasVideoMeta || !metaEqual) {
        if (options) {
          options.meta = Object.assign({}, meta);
        } else {
          options = {
            meta: Object.assign({}, meta)
          };
        }
        this._hasVideoMeta = true;
        this.emit(TsDemuxer.EVENTS.METADATA_PARSED, 'video', meta);
      }
    }

    const data = new Uint8Array(sampleLength);
    let offset = 0;
    let isKeyframe = false;
    for (let i = 0; i < nals.length; i++) {
      let nal = nals[i];
      if (nal.type && nal.type >= 9) {
        continue;
      }
      let length = nal.body.byteLength;
      if (nal.idr) {
        isKeyframe = true;
      }
      if (!nal.pps && !nal.sps && !nal.sei) {
        data.set(new Uint8Array([length >>> 24 & 0xff,
          length >>> 16 & 0xff,
          length >>> 8 & 0xff,
          length & 0xff
        ]), offset);
        offset += 4;
        data.set(nal.body, offset);
        offset += length;
      }
    }
    const dts = parseInt(pes.dts / 90);
    const pts = parseInt(pes.pts / 90);

    if (seiList.length) {
      seiList.forEach((sei) => {
        sei.dts = dts;
        this.emit(TsDemuxer.EVENTS.SEI_PARSED, sei);
      });
    }
    const sample = new VideoSample({
      dts: dts,
      pts: pts,
      cts: pts - dts,
      originDts: pes.dts,
      isKeyframe,
      data,
      nals,
      options,
      firstInGop: isKeyframe,
      gopId: isKeyframe ? ++this.gopId : this.gopId
    });
    this.emit(TsDemuxer.EVENTS.VIDEO_SAMPLE_PARSED, sample);
  }

  pushVideoSampleHEVC (pes, options) {
    let nals = NalUnitHEVC.getNalunits(pes.ES.buffer);
    nals = nals.filter(x => x.body && x.body.length);
    let meta = new VideoTrackMeta();
    meta.streamType = 0x24;

    let sampleLength = 0;
    let vps = false;
    let sps = false;
    let pps = false;
    let seiList = [];
    let hasVPS = false;
    let hasSPS = false;
    let hasPPS = false;
    let firstInGop = false;
    for (let i = 0; i < nals.length; i++) {
      let nal = nals[i];

      if (nal.vps) {
        if (hasVPS) {
          continue;
        } else {
          hasVPS = true;
        }
      } else if (nal.sps) {
        if (hasSPS) {
          continue;
        } else {
          hasSPS = true;
        }
      } else if (nal.pps) {
        if (hasPPS) {
          continue;
        } else {
          hasPPS = true;
        }
      } else if (nal.key) {
        if (nal.type === 20 || nal.type === 19) {
          firstInGop = true;
        }
      } else if (nal.type === 0) {
        // if (!hasKeyframe) {
        //   continue;
        // }
      } else if (nal.type === 35) {
        continue;
      }
      if (nal.sps) {
        sps = nal;
        meta.sps = nal.body;

        meta.presentWidth = sps.sps.width;
        meta.presentHeight = sps.sps.height;
        meta.general_profile_space = sps.sps.general_profile_space;
        meta.general_tier_flag = sps.sps.general_tier_flag;
        meta.general_profile_idc = sps.sps.general_profile_idc;
        meta.general_level_idc = sps.sps.general_level_idc;
        // meta.duration = this._duration;
        meta.codec = 'hev1.1.6.L93.B0';
        meta.chromaFormatIdc = sps.sps.chromaFormatIdc;
        meta.bitDepthLumaMinus8 = sps.sps.bitDepthLumaMinus8;
        meta.bitDepthChromaMinus8 = sps.sps.bitDepthChromaMinus8;
      } else if (nal.pps) {
        meta.pps = nal.body;
        pps = nal;
      } else if (nal.vps) {
        meta.vps = nal.body;
        vps = nal;
      } else if (nal.sei) {
        seiList.push(nal.sei);
      }
      if (nal.type <= 40) {
        sampleLength += (4 + nal.body.byteLength);
      }
    }

    if (sps && pps && vps) {
      // meta.avcc = NalUnitHEVC.getAvcc(sps.body, pps.body);
      let metaEqual = TsDemuxer.compareMeta(this.videoTrack.meta, meta, true);
      if (!this._hasVideoMeta || !metaEqual) {
        if (options) {
          options.meta = Object.assign({}, meta);
        } else {
          options = {
            meta: Object.assign({}, meta)
          };
        }
        meta.streamType = 0x24;
        this.videoTrack.meta = meta;
        this._hasVideoMeta = true;
        this.emit(TsDemuxer.EVENTS.METADATA_PARSED, 'video', meta);
      }
    }

    let data = new Uint8Array(sampleLength);
    let offset = 0;
    let isKeyframe = false;
    hasVPS = false;
    hasSPS = false;
    hasPPS = false;
    for (let i = 0; i < nals.length; i++) {
      let nal = nals[i];
      if (nal.type && nal.type > 40) {
        continue;
      }

      if (nal.vps) {
        if (hasVPS) {
          continue;
        } else {
          hasVPS = true;
        }
      } else if (nal.sps) {
        if (hasSPS) {
          continue;
        } else {
          hasSPS = true;
        }
      } else if (nal.pps) {
        if (hasPPS) {
          continue;
        } else {
          hasPPS = true;
        }
      } else if (nal.key) {
      } else if (nal.type === 0) {
        // if (!hasKeyframe) {
        //   continue;
        // }
      } else if (nal.type === 35) {
        continue;
      }
      let length = nal.body.byteLength;
      if (nal.key) {
        isKeyframe = true;
      }
      // if (!nal.vps && !nal.pps && !nal.sps) {
      data.set(new Uint8Array([length >>> 24 & 0xff,
        length >>> 16 & 0xff,
        length >>> 8 & 0xff,
        length & 0xff
      ]), offset);
      offset += 4;
      data.set(nal.body, offset);
      offset += length;
      // }
    }
    const dts = parseInt(pes.dts / 90);
    const pts = parseInt(pes.pts / 90);

    if (seiList) {
      seiList.forEach((sei) => {
        sei.dts = dts;
        this.emit(TsDemuxer.EVENTS.SEI_PARSED, sei);
      })
    }

    const sample = new VideoSample({
      dts,
      pts,
      cts: pts - dts,
      originDts: pes.dts,
      isKeyframe,
      data,
      nals,
      options,
      firstInGop: firstInGop,
      gopId: firstInGop ? ++this.gopId : this.gopId
    });
    this.emit(TsDemuxer.EVENTS.VIDEO_SAMPLE_PARSED, sample)
  }

  destroy () {
    this.removeAllListeners();
    this.configs = {};
    this.demuxing = false;
    this.pat = [];
    this.pmt = [];
    this._hasVideoMeta = false;
    this._hasAudioMeta = false;
  }

  static compareArray (a, b, type) {
    let al = 0;
    let bl = 0;
    if (type === 'Uint8Array') {
      al = a.byteLength;
      bl = b.byteLength;
    } else if (type === 'Array') {
      al = a.length;
      bl = b.length;
    }
    if (al !== bl) {
      return false;
    }

    for (let i = 0; i < al; i++) {
      if (a[i] !== b[i]) {
        return false;
      }
    }
    return true;
  }

  static compareMeta (a, b, ignoreDuration) {
    if (!a || !b) {
      return false;
    }

    for (let i = 0, k = Object.keys(a).length; i < k; i++) {
      let itema = a[Object.keys(a)[i]];
      let itemb = b[Object.keys(a)[i]];
      if (!itema && !itemb) {
        return true;
      }

      if (((itema === undefined || itema === null) && itemb) || (itema && itemb === undefined)) {
        return false;
      }

      if (typeof itema !== 'object') {
        if ((ignoreDuration && Object.keys(a)[i] !== 'duration' && Object.keys(a)[i] !== 'refSampleDuration' && Object.keys(a)[i] !== 'refSampleDurationFixed') && itema !== itemb) {
          return false;
        }
      } else if (itema.byteLength !== undefined) {
        if (itemb.byteLength === undefined) {
          return false;
        }
        if (!TsDemuxer.compareArray(itema, itemb, 'Uint8Array')) {
          return false;
        }
      } else if (itema.length !== undefined) {
        if (itemb.length === undefined) {
          return false;
        }
        if (!TsDemuxer.compareArray(itema, itemb, 'Array')) {
          return false;
        }
      } else {
        if (!TsDemuxer.compareMeta(itema, itemb)) {
          return false;
        }
      }
    }
    return true;
  }

  static mergeVideoES (buffers) {
    let data;
    let length = 0;
    let offset = 0;
    for (let i = 0; i < buffers.length; i++) {
      length += (buffers[i].length - buffers[i].position);
    }

    data = new Uint8Array(length);
    for (let i = 0; i < buffers.length; i++) {
      let buffer = buffers[i];
      data.set(new Uint8Array(buffer.buffer, buffer.position), offset);
      offset += buffer.length - buffer.position;
    }
    return new XGDataView(data.buffer);
  }

  static mergeAudioES (buffers) {
    let data;
    let length = 0;
    let offset = 0;
    for (let i = 0; i < buffers.length; i++) {
      length += buffers[i].length;
    }

    data = new Uint8Array(length);
    for (let i = 0; i < buffers.length; i++) {
      let buffer = buffers[i];
      data.set(new Uint8Array(buffer.buffer), offset);
      offset += buffer.length;
    }

    return new XGDataView(data.buffer);
  }

  static read (stream, ts, frags) {
    TsDemuxer.readHeader(stream, ts);
    TsDemuxer.readPayload(stream, ts, frags);
    // console.log('start', window.performance.now());
    // console.log('end', window.performance.now());
    if (ts.header.packet === 'MEDIA' && ts.header.payload === 1 && !ts.unknownPIDs) {
      ts.pes = TsDemuxer.PES(ts);
    }
  }

  static readPayload (stream, ts, frags) {
    let header = ts.header;
    let pid = header.pid;
    switch (pid) {
      case 0:
        TsDemuxer.PAT(stream, ts, frags);
        break;
      case 1:
        TsDemuxer.CAT(stream, ts, frags);
        break;
      case 2:
        TsDemuxer.TSDT(stream, ts, frags);
        break;
      case 0x1fff:
        break;
      default:
        let isPMT = false;
        for (let i = 0, len = frags.pat.length; i < len; i++) {
          if (frags.pat[i].pid === pid) {
            isPMT = true;
            break;
          }
        }
        // TODO: some的写法不太好，得改
        if (isPMT) {
          TsDemuxer.PMT(stream, ts, frags);
        } else {
          let sts = []
          for (let i = 0, len = frags.pmt.length; i < len; i++) {
            if (frags.pmt[i].pid === pid) {
              sts.push(frags.pmt[i])
              break;
            }
          }
          if (sts.length > 0) {
            let streamType = sts[0].streamType;
            TsDemuxer.Media(stream, ts, streamType);
          } else {
            ts.unknownPIDs = true;
          }
        }
    }
  }

  static readHeader (stream, ts) {
    let header = {};
    header.sync = stream.readUint8();
    let next = stream.readUint16();
    header.error = next >>> 15;
    header.payload = next >>> 14 & 1;
    header.priority = next >>> 13 & 1;
    header.pid = next & 0x1fff;

    next = stream.readUint8();

    header.scrambling = next >> 6 & 0x3; // 是否加密，00表示不加密

    /**
     * 00 ISO/IEC未来使用保留
     * 01 没有调整字段，仅含有184B有效净荷
     * 02 没有有效净荷，仅含有183B调整字段
     * 03 0~182B调整字段后为有效净荷
     */
    header.adaptation = next >> 4 & 0x3;
    header.continuity = next & 15;
    header.packet = header.pid === 0 ? 'PAT' : 'MEDIA';
    ts.header = header;
  }

  static PAT (stream, ts, frags) {
    let ret = {};
    let next = stream.readUint8();
    stream.skip(next);
    next = stream.readUint8();
    ret.tabelID = next;
    next = stream.readUint16();
    ret.error = next >>> 7;
    ret.zero = next >>> 6 & 1;
    ret.sectionLength = next & 0xfff;
    ret.streamID = stream.readUint16();
    ret.current = stream.readUint8() & 1;
    ret.sectionNumber = stream.readUint8();
    ret.lastSectionNumber = stream.readUint8();
    let N = (ret.sectionLength - 9) / 4;
    let list = [];
    for (let i = 0; i < N; i++) {
      let programNumber = stream.readUint16();
      let pid = stream.readUint16() & 0x1fff;
      list.push({
        program: programNumber,
        pid,
        type: programNumber === 0 ? 'network' : 'mapPID'
      });
    }
    if (list.length > 0) {
      frags.pat = frags.pat.concat(list);
    }
    ret.list = list;
    ret.program = stream.readUint16();
    ret.pid = stream.readUint16() & 0x1fff;
    ts.payload = ret;
    // TODO CRC
  }

  static PMT (stream, ts, frags) {
    let ret = {};
    let header = ts.header;
    header.packet = 'PMT';
    let next = stream.readUint8();
    stream.skip(next);
    next = stream.readUint8();
    ret.tableID = next;
    next = stream.readUint16();
    ret.sectionLength = next & 0xfff;
    ret.program = stream.readUint16();
    ret.current = stream.readUint8() & 1;
    ret.order = stream.readUint8();
    ret.lastOrder = stream.readUint8();
    ret.PCR_PID = stream.readUint16() & 0x1fff;
    ret.programLength = stream.readUint16() & 0xfff;
    let N = (ret.sectionLength - 13) / 5;
    let list = [];
    for (let i = 0; i < N; i++) {
      list.push({
        streamType: stream.readUint8(),
        pid: stream.readUint16() & 0x1fff, // 0x07e5 视频，0x07e6
        es: stream.readUint16() & 0xfff
      });
    }
    ret.list = list;
    if (!this.pmt) {
      this.pmt = [];
    }
    frags.pmt = this.pmt.concat(list.map((item) => {
      return {
        pid: item.pid,
        es: item.es,
        streamType: item.streamType,
        program: ret.program
      };
    }));
    ts.payload = ret;
  }

  static Media (stream, ts, streamType) {
    let header = ts.header;
    let payload = {};
    const [type, codec] = StreamType[streamType];
    header.streamType = streamType;
    header.type = type;
    header.codec = codec;

    if (header.adaptation === 0x03) {
      payload.adaptationLength = stream.readUint8();
      if (payload.adaptationLength > 0) {
        let next = stream.readUint8();
        payload.discontinue = next >>> 7;
        payload.access = next >>> 6 & 0x01;
        payload.priority = next >>> 5 & 0x01;
        payload.PCR = next >>> 4 & 0x01;
        payload.OPCR = next >>> 3 & 0x01;
        payload.splicePoint = next >>> 2 & 0x01;
        payload.transportPrivate = next >>> 1 & 0x01;
        payload.adaptationField = next & 0x01;
        let _start = stream.position;
        if (payload.PCR === 1) {
          payload.programClockBase = stream.readUint32() << 1;
          next = stream.readUint16();
          payload.programClockBase |= next >>> 15;
          payload.programClockExtension = next & 0x1ff;
        }
        if (payload.OPCR === 1) {
          payload.originProgramClockBase = stream.readUint32() << 1;
          next = stream.readUint16();
          payload.originProgramClockBase += next >>> 15;
          payload.originProgramClockExtension = next & 0x1ff;
        }
        if (payload.splicePoint === 1) {
          payload.spliceCountdown = stream.readUint8();
        }
        if (payload.transportPrivate === 1) {
          let length = stream.readUint8();
          let transportPrivateData = [];
          for (let i = 0; i < length; i++) {
            transportPrivateData.push(stream.readUint8());
          }
        }
        if (payload.adaptationField === 1) {
          let length = stream.readUint8();
          let next = stream.readUint8();
          let start = stream.position;
          let ltw = next >>> 7;
          let piecewise = next >>> 6 & 0x1;
          let seamless = next >>> 5 & 0x1;
          if (ltw === 1) {
            next = stream.readUint16();
            payload.ltwValid = next >>> 15;
            payload.ltwOffset = next & 0xefff;
          }
          if (piecewise === 1) {
            next = stream.readUint24();
            payload.piecewiseRate = next & 0x3fffff;
          }
          if (seamless === 1) {
            next = stream.readInt8();
            payload.spliceType = next >>> 4;
            payload.dtsNextAU1 = next >>> 1 & 0x7;
            payload.marker1 = next & 0x1;
            next = stream.readUint16();
            payload.dtsNextAU2 = next >>> 1;
            payload.marker2 = next & 0x1;
            next = stream.readUint16();
            payload.dtsNextAU3 = next;
          }
          stream.skip(length - 1 - (stream.position - start));
        }
        let lastStuffing = payload.adaptationLength - 1 - (stream.position - _start);
        stream.skip(lastStuffing);
      }
    }
    payload.stream = new XGDataView(stream.buffer.slice(stream.position));
    ts.payload = payload;
  }

  /**
   * http://dvd.sourceforge.net/dvdinfo/pes-hdr.html
   * ISO-13818-1 Table-2-17
   * packet_start_code_prefix : 24bit 0x000001
   * stream_id : 8bit
   * PES_packet_length : 16bit
   * PTS_DTS_flags : 2bit 【PES_packet_length后第2字节前2位】& 0xc0  [0x10 0x11]
   * PES_header_data_length : 【PTS_DTS_flags 后第1字节】
   *
   * | 6字节header | 3字节扩展 | PES Header data | payload |
   */
  static PES (ts) {
    let ret = {};
    let buffer = ts.payload.stream;

    let next = buffer.readUint24();
    if (next !== 1) {
      ret.ES = {};
      ret.ES.buffer = buffer;
    } else {
      let streamID = buffer.readUint8();
      if (streamID >= 0xe0 && streamID <= 0xef) {
        ret.type = 'video';
      }
      if (streamID >= 0xc0 && streamID <= 0xdf) {
        ret.type = 'audio';
      }
      let packetLength = buffer.readUint16();
      ret.packetLength = packetLength;
      if (ret.type === 'video' || ret.type === 'audio') {
        let next = buffer.readUint8();
        let first = next >>> 6;
        if (first !== 0x02) {
          throw new Error('error when parse pes header');
        }
        next = buffer.readUint8();
        ret.ptsDTSFlag = next >>> 6;
        ret.escrFlag = next >>> 5 & 0x01;
        ret.esRateFlag = next >>> 4 & 0x01;
        ret.dsmFlag = next >>> 3 & 0x01;
        ret.additionalFlag = next >>> 2 & 0x01;
        ret.crcFlag = next >>> 1 & 0x01;
        ret.extensionFlag = next & 0x01;
        ret.pesHeaderLength = buffer.readUint8();
        let N1 = ret.pesHeaderLength;

        if (ret.ptsDTSFlag === 2) {
          let pts = [];
          next = buffer.readUint8();
          pts.push(next >>> 1 & 0x07);
          next = buffer.readUint16();
          pts.push(next >>> 1);
          next = buffer.readUint16();
          pts.push(next >>> 1);
          ret.pts = (pts[0] << 30 | pts[1] << 15 | pts[2]);
          N1 -= 5;
          // 视频如果没有dts用pts
          if (ret.type === 'video') {
            ret.dts = ret.pts;
          }
        }
        if (ret.ptsDTSFlag === 3) {
          let pts = [];
          next = buffer.readUint8();
          pts.push(next >>> 1 & 0x07);
          next = buffer.readUint16();
          pts.push(next >>> 1);
          next = buffer.readUint16();
          pts.push(next >>> 1);
          ret.pts = (pts[0] << 30 | pts[1] << 15 | pts[2]);
          let dts = [];
          next = buffer.readUint8();
          dts.push(next >>> 1 & 0x07);
          next = buffer.readUint16();
          dts.push(next >>> 1);
          next = buffer.readUint16();
          dts.push(next >>> 1);
          ret.dts = (dts[0] << 30 | dts[1] << 15 | dts[2]);
          N1 -= 10;
        }
        if (ret.escrFlag === 1) {
          let escr = [];
          let ex = [];
          next = buffer.readUint8();
          escr.push(next >>> 3 & 0x07);
          escr.push(next & 0x03);
          next = buffer.readUint16();
          escr.push(next >>> 13);
          escr.push(next & 0x03);
          next = buffer.readUint16();
          escr.push(next >>> 13);
          ex.push(next & 0x03);
          next = buffer.readUint8();
          ex.push(next >>> 1);
          ret.escr = (escr[0] << 30 | escr[1] << 28 | escr[2] << 15 | escr[3] << 13 | escr[4]) * 300 + (ex[0] << 7 | ex[1]);
          N1 -= 6;
        }
        if (ret.esRateFlag === 1) {
          next = buffer.readUint24();
          ret.esRate = next >>> 1 & 0x3fffff;
          N1 -= 3;
        }
        if (ret.dsmFlag === 1) {
          throw new Error('not support DSM_trick_mode');
        }
        if (ret.additionalFlag === 1) {
          next = buffer.readUint8();
          ret.additionalCopyInfo = next & 0x7f;
          N1 -= 1;
        }
        if (ret.crcFlag === 1) {
          ret.pesCRC = buffer.readUint16();
          N1 -= 2;
        }
        if (ret.extensionFlag === 1) {
          throw new Error('not support extension');
        }
        if (N1 > 0) {
          buffer.skip(N1);
        }
        if (ret.dts > ret.pts) {
          ret.dts = ret.pts;
        }
        ret.ES = TsDemuxer.ES(buffer, ret.type, ts.header.streamType);
      } else {
        throw new Error('format is not supported');
      }
    }
    return ret;
  }

  static ES (buffer, type, streamType) {
    let ret = {};
    if (type === 'video') {
      // TODO readnalu
      ret.buffer = buffer;
    } else if (type === 'audio') {
      if (streamType === 0x0f || streamType === 0x11) {
        ret = TsDemuxer.parseADTSHeader(buffer);
      }
      ret.buffer = buffer;
    } else {
      throw new Error(`ES ${type} is not supported`);
    }

    return ret;
  }

  static parseADTSHeader (buffer) {
    let ret = {};
    let next = buffer.readUint16();
    // adts的同步字节，12位
    if (next >>> 4 !== 0xfff) {
      throw new Error('aac ES parse Error');
    }
    const fq = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
    ret.id = (next >>> 3 & 0x01) === 0 ? 'MPEG-4' : 'MPEG-2';
    ret.layer = next >>> 1 & 0x03;
    ret.absent = next & 0x01;
    next = buffer.readUint16();
    ret.audioObjectType = (next >>> 14 & 0x03) + 1;
    ret.profile = ret.audioObjectType - 1;
    ret.frequencyIndex = next >>> 10 & 0x0f;
    ret.frequence = fq[ret.frequencyIndex];
    ret.channel = next >>> 6 & 0x07;
    ret.frameLength = (next & 0x03) << 11 | (buffer.readUint16() >>> 5);
    TsDemuxer.getAudioConfig(ret);
    buffer.skip(1);
    ret.buffer = buffer;
    return ret;
  }

  static TSDT (stream, ts, frags) {
    // TODO
    ts.payload = {};
  }

  static CAT (stream, ts, frags) {
    let ret = {};
    ret.tableID = stream.readUint8();
    let next = stream.readUint16();
    ret.sectionIndicator = next >>> 7;
    ret.sectionLength = next & 0x0fff;
    stream.skip(2);
    next = stream.readUint8();
    ret.version = next >>> 3;
    ret.currentNextIndicator = next & 0x01;
    ret.sectionNumber = stream.readUint8();
    ret.lastSectionNumber = stream.readUint8();
    let N = (this.sectionLength - 9) / 4;
    let list = [];
    for (let i = 0; i < N; i++) {
      list.push({});
    }
    ret.crc32 = stream.readUint32();
    ts.payload = ret;
  }

  static getAudioConfig (ret) {
    let userAgent = navigator.userAgent.toLowerCase();
    let config;
    let extensionSampleIndex;
    ret.originAudioObjectType = ret.audioObjectType;
    if (/firefox/i.test(userAgent)) {
      if (ret.frequencyIndex >= 6) {
        ret.audioObjectType = 5;
        config = new Array(4);
        extensionSampleIndex = ret.frequencyIndex - 3;
      } else {
        ret.audioObjectType = 2;
        config = new Array(2);
        extensionSampleIndex = ret.frequencyIndex;
      }
    } else if (userAgent.indexOf('android') !== -1) {
      ret.audioObjectType = 2;
      config = new Array(2);
      extensionSampleIndex = ret.frequencyIndex;
    } else {
      ret.audioObjectType = 5;
      config = new Array(4);
      if (ret.frequencyIndex >= 6) {
        extensionSampleIndex = ret.frequencyIndex - 3;
      } else {
        if (ret.channel === 1) {
          ret.audioObjectType = 2;
          config = new Array(2);
        }
        extensionSampleIndex = ret.frequencyIndex;
      }
    }

    config[0] = ret.audioObjectType << 3;
    config[0] |= (ret.frequencyIndex & 0x0e) >> 1;
    config[1] = (ret.frequencyIndex & 0x01) << 7;
    config[1] |= ret.channel << 3;
    if (ret.audioObjectType === 5) {
      config[1] |= (extensionSampleIndex & 0x0e) >> 1;
      config[2] = (extensionSampleIndex & 0x01) << 7;
      config[2] |= 2 << 2;
      config[3] = 0;
    }

    ret.audioConfig = config;
  }
}

export default TsDemuxer;