import sniffer from '../utils/sniffer'
// import Danmu from '../plugins/danmu'
import Xglogger from '../plugins/logger'
import Replay from '../plugins/replay'
import Poster from '../plugins/poster'
import Start from '../plugins/start'
import Enter from '../plugins/enter'
import Miniscreen from '../plugins/miniScreen'
import PC from '../plugins/pc'
import Mobile from '../plugins/mobile'
import Keyboard from '../plugins/keyboard'
import Loading from '../plugins/loading'
import Progress from '../plugins/progress'
import PlayIcon from '../plugins/play'
import FullScreen from '../plugins/fullscreen'
import TimeIcon from '../plugins/time'
import Volume from '../plugins/volume'
import RotateIcon from '../plugins/rotate'
import PIPIcon from '../plugins/pip'
import PlayNextIcon from '../plugins/playNext'
import DownLoadIcon from '../plugins/download'
import ScreenShotIcon from '../plugins/screenShot'
import DefinitionIcon from '../plugins/definition'
import PlaybackRateIcon from '../plugins/playbackRate'
import CssFullScreen from '../plugins/cssFullScreen'
import Error from '../plugins/error'
import Prompt from '../plugins/prompt'
import ProgressPreview from '../plugins/progressPreview'
import Thumbnail from '../plugins/common/thumbnail'
import MiniProgress from '../plugins/progress/miniProgress'
import DynamicBg from '../plugins/dynamicBg'
import ZH from '../lang/zh-cn'

export default class DefaultPreset {
  constructor (options, playerConfig) {
    const simulateMode = playerConfig && playerConfig.isMobileSimulateMode
    const { isLive } = playerConfig
    const vodPlugins = isLive ? [] : [Progress, MiniProgress, ProgressPreview, TimeIcon]

    const contolsIcons = [...vodPlugins, PlayIcon, FullScreen,
      RotateIcon, PlayNextIcon, DefinitionIcon, PlaybackRateIcon, DownLoadIcon, ScreenShotIcon, Volume, PIPIcon]

    const layers = [Replay, Poster, Start, Loading, Enter, Error, Prompt, Thumbnail, Miniscreen]

    this.plugins = [Xglogger, ...contolsIcons, ...layers]
    const mode = simulateMode ? 'mobile' : sniffer.device
    switch (mode) {
      case 'pc':
        this.plugins.push(...[Keyboard, PC, CssFullScreen])
        break
      case 'mobile':
        this.plugins.push(...[Mobile])
        break
      default:
        this.plugins.push(...[Keyboard, PC, CssFullScreen])
    }
    if (sniffer.os.isIpad || mode === 'pc') {
      this.plugins.push(DynamicBg)
    }
    this.ignores = []
    this.i18n = [ZH]
  }
}
