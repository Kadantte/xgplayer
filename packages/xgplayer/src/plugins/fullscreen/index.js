import Plugin, {hooksDescriptor, Events, POSITIONS, Sniffer} from '../../plugin'
import TopBackIcon from './backicon'
import FullScreenSvg from '../assets/requestFull.svg'
import ExitFullScreenSvg from '../assets/exitFull.svg'

export default class Fullscreen extends Plugin {
  static get pluginName () {
    return 'fullscreen'
  }

  static get defaultConfig () {
    return {
      position: POSITIONS.CONTROLS_RIGTH,
      index: 0,
      useCssFullscreen: false,
      switchCallback: null,
      target: null,
      disable: false,
      needBackIcon: false
    }
  }

  beforeCreate (args) {
    if (typeof args.player.config.fullscreen === 'boolean') {
      args.config.disable = !args.player.config.fullscreen
    }
  }

  afterCreate () {
    hooksDescriptor(this)
    if (this.config.disable) {
      return
    }
    this.isFullScreen = this.player.isFullScreen
    this.initIcons()

    this.fullSreenHandler = this.hook('fullsreen_change', this.changeFullScreen)

    this.bind('.xgplayer-fullscreen', Sniffer.device === 'mobile' ? 'touchend' : 'click', this.fullSreenHandler)

    this.on(Events.FULLSCREEN_CHANGE, (isFullScreen) => {
      this.changeLangTextKey(this.find('.xg-tips'), isFullScreen ? this.i18nKeys.EXITFULLSCREEN_TIPS : this.i18nKeys.FULLSCREEN_TIPS)
      this.animate(isFullScreen)
    })
    if (Sniffer.device === 'mobile' && this.config.needBackIcon) {
      this.topBackIcon = this.player.registerPlugin({
        plugin: TopBackIcon,
        options: {
          config: {
            onClick: (e) => {
              this.show()
              this.fullSreenHandler(e)
            }
          }
        }
      })
    }
  }

  registerIcons () {
    return {
      fullscreen: {icon: FullScreenSvg, class: 'xg-get-fullscreen'},
      exitFullscreen: {icon: ExitFullScreenSvg, class: 'xg-exit-fullscreen'}
    }
  }

  destroy () {
    this.unbind('.xgplayer-icon', Sniffer.device === 'mobile' ? 'touchend' : 'click', this.fullSreenHandler)
  }

  initIcons () {
    const {icons} = this
    this.appendChild('.xgplayer-icon', icons.fullscreen)
    this.appendChild('.xgplayer-icon', icons.exitFullscreen)
  }

  changeFullScreen (e) {
    // e.preventDefault();
    e.stopPropagation();
    const {player, config} = this;
    let useCssFullscreen = false
    if (config.useCssFullscreen === true || (typeof config.useCssFullscreen === 'function' && config.useCssFullscreen())) {
      useCssFullscreen = true;
    }
    if (useCssFullscreen) {
      if (player.fullscreen) {
        player.exitCssFullscreen()
        player.fullscreen = false
        this.emit(Events.FULLSCREEN_CHANGE, false)
      } else {
        player.getCssFullscreen()
        player.fullscreen = true
        this.emit(Events.FULLSCREEN_CHANGE, true)
      }
      this.animate(player.fullscreen)
    } else {
      if (config.switchCallback && typeof config.switchCallback === 'function') {
        config.switchFullScreen(this.isFullScreen)
        this.isFullScreen = !this.isFullScreen
        return
      }
      if (player.fullscreen) {
        player.exitFullscreen(config.target)
      } else {
        player.getFullscreen(config.target)
      }
    }
  }

  animate (isFullScreen) {
    isFullScreen ? this.setAttr('data-state', 'full') : this.setAttr('data-state', 'normal')
    if (this.topBackIcon) {
      if (isFullScreen) {
        this.topBackIcon.show()
        this.hide()
      } else {
        this.topBackIcon.hide()
        this.show()
      }
    }
  }

  show () {
    super.show()
  }

  hide () {
    super.hide()
  }

  render () {
    if (this.config.disable) {
      return
    }
    const langKey = 'FULLSCREEN_TIPS'
    return `<xg-icon class="xgplayer-fullscreen">
    <div class="xgplayer-icon">
    </div>
    <div class="xg-tips" lang-key="${this.i18nKeys[langKey]}">${this.i18n[langKey]}</div>
    </xg-icon>`
  }
}
