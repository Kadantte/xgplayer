/**
 * 下一个按钮组件
 */
import Plugin from '../../plugin'
import Next from '../assets/playNext.svg'
// import Next from '../assets/mPlayNext.svg';
// console.log(MPlayNext)
const {POSITIONS, Sniffer} = Plugin
export default class PlayNextIcon extends Plugin {
  static get pluginName () {
    return 'PlayNext'
  }

  static get defaultConfig () {
    return {
      position: POSITIONS.CONTROLS_LEFT,
      index: 1,
      url: null,
      urlList: []
    }
  }

  constructor (options) {
    super(options);
    this.idx = -1;
  }

  afterCreate () {
    if (!this.config.urlList || this.config.urlList.length === 0) {
      return
    }
    this.initEvents()
  }

  initEvents () {
    this.playNext = this.playNext.bind(this);
    const event = Sniffer.device === 'mobile' ? 'touchend' : 'click'
    this.bind(event, this.playNext)
    this.show()
  }

  playNext () {
    const { player } = this;
    if (this.idx + 1 < this.config.urlList.length) {
      this.idx++;
      player.video.pause();
      player.currentTime = 0;
      player.video.autoplay = true;
      player.src = this.config.urlList[this.idx];
      player.emit('playerNext', this.idx + 1);
    } else {
      player.emit('urlList last');
    }
  }

  registerIcons () {
    return {
      playNext: Next
    }
  }

  registerLangauageTexts () {
    return {
      'playNext': {
        jp: 'play',
        en: 'play',
        zh: '播放'
      }
    }
  }

  destroy () {
    this.unbind(['touchend', 'click'], this.playNext)
  }

  render () {
    if (!this.config.urlList || this.config.urlList.length === 0) {
      return
    }
    return `
     <xg-icon class="xgplayer-playnext">
      <div class="xgplayer-icon">
        ${this.icons.playNext}
      </div>
      <div class="xg-tips">${this.text.playNext}</div>
     </xg-icon>
    `
  }
}