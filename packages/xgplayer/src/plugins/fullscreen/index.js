import Plugin from '../../plugin'
import FullScreenChangeSvg from '../assets/fullscreenChange.svg'

const {Events, POSITIONS} = Plugin

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
      target: null
    }
  }

  afterCreate () {
    this.isFullScreen = this.player.isFullScreen
    this.btnClick = this.btnClick.bind(this)
    this.bind(['click', 'touchend'], this.btnClick)
    this.on(Events.FULLSCREEN_CHANGE, (isFullScreen) => {
      this.find('.xg-tips').innerHTML = isFullScreen ? this.text.exitFullscreen : this.text.fullscreen
      this.animate(isFullScreen)
    })
  }

  btnClick (e) {
    const {player, config} = this;
    let useCssFullscreen = false
    if (config.useCssFullscreen === true || (typeof config.useCssFullscreen === 'function' && config.useCssFullscreen())) {
      useCssFullscreen = true;
    }
    if (useCssFullscreen) {
      if (player.fullscreen) {
        player.getCssFullscreen()
        player.fullscreen = true
        this.emit(Events.FULLSCREEN_CHANGE, true)
      } else {
        player.exitCssFullscreen()
        player.fullscreen = false
        this.emit(Events.FULLSCREEN_CHANGE, false)
      }
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
    const path = this.find('.path')
    const full = this.find('.path_full').getAttribute('d')
    const exit = this.find('.path_exitfull').getAttribute('d')
    isFullScreen ? path.setAttribute('d', exit) : path.setAttribute('d', full)
  }

  registerLangauageTexts () {
    return {
      fullscreen: {
        jp: 'フルスクリーン',
        en: 'Fullscreen',
        zh: '进入全屏'
      },
      exitFullscreen: {
        jp: 'フルスクリーン',
        en: 'Exit fullscreen',
        zh: '退出全屏'
      }
    }
  }

  registerIcons () {
    return {
      fullscreenChange: FullScreenChangeSvg
    }
  }

  destroy () {
    this.unbind(['click', 'touchend'], this.btnClick)
  }

  render () {
    return `<xg-icon class="xgplayer-fullscreen">
    <div class="xgplayer-icon">
    ${this.icons.fullscreenChange}
    </div>
    <div class="xg-tips">${this.player.isFullScreen ? this.text.exitFullscreen : this.text.fullscreen}</div>
    </xg-icon>`
  }
}