// ==UserScript==
// @name         Bilibili 播放器旋转 / 缩放 / 镜像
// @namespace    https://github.com/shengurun/bilibili-video-rotate
// @version      1.4.1
// @description  在 B 站播放器上旋转 90°、水平/垂直镜像并按真实画面自动适配（默认完整显示，网页全屏时铺满整个浏览器窗口），不旋转弹幕/字幕/控制条；同一视频内切换标签页或播放器重建后保留变换。新增 WebGL 渲染实验模式（默认关闭）。单击悬浮按钮快速切换旋转，右键打开控制面板。
// @author       shengurun
// @match        https://www.bilibili.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

/*
 * 安装
 *   1. 安装 Tampermonkey（或兼容的 userscript 管理器）。
 *   2. 新建脚本，粘贴本文件全部内容，保存。
 *   3. 打开任意 B 站视频页（www.bilibili.com/video/... 或番剧页）。
 *   4. 旧版「Bilibili 播放器旋转 / 缩放」（bilibili-rotate）请先删除，
 *      否则会出现两个悬浮按钮并互相覆盖画面变换。
 *
 * 操作
 *   - 单击悬浮按钮：在「原始画面」与「逆时针 90° + 按当前适配模式缩放」之间切换，镜像状态保留。
 *   - 右键悬浮按钮：打开控制面板（90° 步进 / ±15° 微调 / 水平与垂直镜像 / 缩放 / 铺满或完整显示 / 渲染模式 / 重置）。
 *   - 拖动悬浮按钮：吸附到屏幕左/右边缘，位置会保存。
 *   - 脚本菜单「旋转 / 还原」：不依赖悬浮按钮的备用开关（全屏时也可用）。
 *   - 脚本菜单「水平镜像 / 还原」「垂直镜像 / 还原」：全屏隐藏悬浮 UI 时切换镜像。
 *   - 脚本菜单「切换 CSS / WebGL 渲染」：全屏隐藏悬浮 UI 时切换渲染模式。
 *   - 脚本菜单「重置悬浮按钮位置」：把按钮放回右侧居中。
 *   - 脚本菜单「输出旋转诊断信息」：在控制台打印当前画面盒/基准区域/镜像/渲染器等实测数值。
 *
 * 渲染模式
 *   - CSS（默认）：直接对 <video> 应用 transform。兼容性最好，但非零旋转会让 Chrome
 *     放弃视频硬件 overlay，播放时 GPU 合成占用显著升高（实测 90° 约 72%）。
 *   - WebGL（实验）：把视频帧上传为纹理，在覆盖播放器区域的 <canvas> 内完成旋转/镜像/缩放，
 *     页面只合成一个未变换的 canvas，用于验证能否重新获得低耗合成路径。默认关闭。
 *   - WebGL 模式不支持 HDR / DRM / 非居中 object-position / 铺满（cover），Phase 1 仅完整显示（contain）；
 *     纹理上传失败、黑帧、上下文丢失或取不到新帧时自动回退 CSS，偏好设置保持不变。
 *   - WebGL 模式没有 0.22s 过渡动画，旋转/缩放即时生效。
 *
 * 行为说明
 *   - 只变换 <video>（CSS 模式）或覆盖播放器的 canvas 内容（WebGL 模式），弹幕、字幕、控制条保持正向不动（已知取舍）。
 *   - 缩放按视频真实画面（object-fit 内容盒）与屏幕坐标计算，而不是元素盒布局尺寸。
 *   - 镜像不改变画面的轴对齐包围盒，因此不影响旋转后的适配计算；
 *     同时开启两向镜像视觉上等同 180°，但角度状态仍为 0°。
 *   - 镜像切换即时生效，不播放过渡动画，避免画面从 1 到 -1 被压扁的闪烁。
 *   - 默认「完整显示」；已手动选择「铺满」的用户保留其选择。
 *   - 普通 / 迷你模式以播放器容器的完整尺寸为基准，滚动时不会按视口裁切基准区域。
 *   - 网页全屏 / 原生全屏时以整个浏览器窗口为基准缩放，超出播放器边界的画面由播放器正常裁剪，
 *     不修改页面内层容器的 overflow。
 *   - 进入网页全屏 / 原生全屏后自动隐藏悬浮按钮与控制面板；退出后按钮回到原位置。
 *   - 旋转/缩放/镜像在同一视频内保留：播放器节点被替换、切换标签页、
 *     标签页被浏览器挂起重载后都会恢复；切换视频 / 分 P / 剧集或点「重置」
 *     才回到 0°/1x/无镜像。
 *   - 画质切换、迷你播放器（按迷你窗口尺寸）、网页全屏、原生全屏只重算缩放，不重置角度与镜像。
 *   - 过渡动画只在手动旋转 / 微调 / 缩放时播放；镜像、弹幕、控制条、全屏等布局变化即时应用，不会重放动画。
 *   - 变换状态只保留在当前标签页会话内（sessionStorage），不会跨标签页共享，关闭标签页即失效。
 *   - 悬浮按钮位置与「铺满/完整显示」偏好会持久化；旧版本（br:icon / br:prefs）的设置会自动迁移。
 *   - 播放器选择器未经真实页面验证（规划阶段 B 站返回 412），已做多级回退；
 *     找不到播放器时脚本静默隐藏，不影响页面。
 *   - 不处理直播与移动端页面。
 */

(function () {
  'use strict';

  const APP_ID = 'bili-video-rotate-root';
  const CLASS_ACTIVE = 'bili-video-rotate-active';
  const CLASS_ANIM = 'bili-video-rotate-anim';
  const CLASS_MEASURE = 'bili-video-rotate-measure';
  /* WebGL 模式隐藏 <video> 时打上的标记：isUsableVideo() 会据此忽略 visibility/opacity */
  const CLASS_WEBGL = 'bili-video-rotate-webgl-hidden';
  const CLASS_CANVAS = 'bili-video-rotate-webgl-canvas';
  const KEY_ICON = 'bvr:icon';
  const KEY_PREFS = 'bvr:prefs';
  const KEY_SESSION = 'bvr:session';
  const KEY_DEBUG = 'bvr:debug';
  const SESSION_TTL = 12 * 60 * 60 * 1000;

  /* 旧版本名称，仅用于一次性设置迁移与残留清理 */
  const LEGACY_APP_ID = 'bili-rotate-root';
  const LEGACY_STYLE_ID = 'bili-rotate-style';
  const LEGACY_KEY_ICON = 'br:icon';
  const LEGACY_KEY_PREFS = 'br:prefs';
  const LEGACY_CLASSES = ['bili-rotate-active', 'bili-rotate-anim', 'bili-rotate-measure'];
  const LEGACY_VARS = ['--br-angle', '--br-scale'];

  const BTN_SIZE = 44;
  const EDGE_MARGIN = 12;
  const PANEL_MARGIN = 8;
  const DRAG_THRESHOLD = 4;
  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 3;
  const ZOOM_STEP = 0.1;
  const FINE_LIMIT = 15;
  const WEB_SCREEN_VALUES = ['webscreen', 'full', 'fullscreen'];

  const oldHost = document.getElementById(APP_ID);
  if (oldHost) oldHost.remove();
  const legacyHost = document.getElementById(LEGACY_APP_ID);
  if (legacyHost) legacyHost.remove();

  cleanupLegacy();

  function cleanupLegacy() {
    try {
      const legacyStyle = document.getElementById(LEGACY_STYLE_ID);
      if (legacyStyle) legacyStyle.remove();

      document.querySelectorAll('.' + CLASS_ACTIVE).forEach(function (el) {
        el.classList.remove(CLASS_ACTIVE);
        try {
          el.style.removeProperty('--bvr-angle');
          el.style.removeProperty('--bvr-scale');
          el.style.removeProperty('--bvr-flip-x');
          el.style.removeProperty('--bvr-flip-y');
        } catch (err) {}
      });

      /* 旧版类名与 CSS 变量：脚本改名后旧实例可能仍在页面上 */
      const legacySelector = LEGACY_CLASSES.map(function (name) {
        return '.' + name;
      }).join(', ');
      document.querySelectorAll(legacySelector).forEach(function (el) {
        LEGACY_CLASSES.forEach(function (name) {
          el.classList.remove(name);
        });
        try {
          LEGACY_VARS.forEach(function (name) {
            el.style.removeProperty(name);
          });
        } catch (err) {}
      });

      document
        .querySelectorAll('.' + CLASS_MEASURE + ', .' + CLASS_ANIM)
        .forEach(function (el) {
          el.classList.remove(CLASS_MEASURE);
          el.classList.remove(CLASS_ANIM);
        });

      /* 上一次实验模式可能留下 canvas / 隐藏标记 */
      document.querySelectorAll('canvas.' + CLASS_CANVAS).forEach(function (el) {
        if (el.parentNode) el.parentNode.removeChild(el);
      });
      document.querySelectorAll('.' + CLASS_WEBGL).forEach(function (el) {
        try {
          if (el.style.getPropertyValue('visibility') === 'hidden') el.style.removeProperty('visibility');
          if (el.style.getPropertyValue('opacity') === '0') el.style.removeProperty('opacity');
          if (el.style.getPropertyValue('pointer-events') === 'none') el.style.removeProperty('pointer-events');
        } catch (err) {}
        el.classList.remove(CLASS_WEBGL);
      });
    } catch (err) {
      /* 旧实例清理失败时不影响新实例 */
    }
  }

  /* ---------- 存储 ---------- */

  const store = {
    set: function (key, value) {
      try {
        if (typeof GM_setValue === 'function') {
          GM_setValue(key, value);
          return;
        }
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch (err) {
        /* 存储失败时保持内存态 */
      }
    }
  };

  /* 读不到时返回 undefined；GM 与 localStorage 的“缺失”语义保持一致 */
  function readStored(key) {
    try {
      if (typeof GM_getValue === 'function') {
        const value = GM_getValue(key, undefined);
        return value === undefined ? undefined : value;
      }
      const raw = window.localStorage.getItem(key);
      return raw === null ? undefined : JSON.parse(raw);
    } catch (err) {
      return undefined;
    }
  }

  /* 新键优先；旧键存在时回写新键（旧键保留，避免额外申请 GM_deleteValue） */
  function storedOrMigrate(key, legacyKey) {
    const value = readStored(key);
    if (value !== undefined) return value;
    if (!legacyKey) return undefined;
    const legacy = readStored(legacyKey);
    if (legacy === undefined) return undefined;
    store.set(key, legacy);
    return legacy;
  }

  const DEFAULT_PREFS = { quickAngle: -90, fit: 'contain', zoomStep: ZOOM_STEP, renderMode: 'css' };
  const storedPrefs = storedOrMigrate(KEY_PREFS, LEGACY_KEY_PREFS);
  const prefs = Object.assign(
    {},
    DEFAULT_PREFS,
    storedPrefs && typeof storedPrefs === 'object' ? storedPrefs : {}
  );
  prefs.quickAngle = -90;
  /* 只有用户显式保存的 cover 才保留，其余（含旧安装）一律完整显示 */
  if (prefs.fit !== 'cover') prefs.fit = 'contain';
  /* 实验模式必须显式开启；旧版本没有该字段时保持 CSS */
  if (prefs.renderMode !== 'webgl') prefs.renderMode = 'css';

  const debugEnabled = !!readStored(KEY_DEBUG);

  const state = {
    quarterTurns: 0,
    fine: 0,
    zoom: 1,
    fit: prefs.fit,
    flipX: false,
    flipY: false
  };

  let iconPos = storedOrMigrate(KEY_ICON, LEGACY_KEY_ICON);
  if (
    !iconPos ||
    typeof iconPos !== 'object' ||
    (iconPos.edge !== 'left' && iconPos.edge !== 'right') ||
    typeof iconPos.top !== 'number' ||
    !isFinite(iconPos.top)
  ) {
    iconPos = { edge: 'right', top: defaultIconTop() };
  }

  /* ---------- 工具 ---------- */

  function clamp(value, min, max) {
    if (max < min) return min;
    return Math.min(max, Math.max(min, value));
  }

  function round1(value) {
    return Math.round(value * 10) / 10;
  }

  function defaultIconTop() {
    return Math.round((window.innerHeight - BTN_SIZE) / 2);
  }

  function currentAngle() {
    return state.quarterTurns * 90 + state.fine;
  }

  /* 只比较视频身份，忽略 spm_id_from / vd_source / t / hash 等跟踪参数 */
  function mediaKey() {
    let path = '/';
    try {
      path = String(window.location.pathname || '/');
    } catch (err) {
      path = '/';
    }

    let page = 1;
    try {
      const value = parseInt(new window.URLSearchParams(window.location.search).get('p'), 10);
      if (isFinite(value) && value > 0) page = value;
    } catch (err) {
      page = 1;
    }

    let match = path.match(/^\/video\/(BV[0-9A-Za-z]+|av\d+)/i);
    if (match) return 'video:' + match[1] + '|p:' + page;
    match = path.match(/^\/bangumi\/play\/(ep\d+|ss\d+)/i);
    if (match) return 'bangumi:' + match[1] + '|p:' + page;

    /* 识别不出的路由（如 /list/）只按路径比较，避免 query 变化导致误重置 */
    return 'path:' + path + '|p:' + page;
  }

  function isTransformActive() {
    return (
      Math.abs(currentAngle()) > 0.001 ||
      Math.abs(state.zoom - 1) > 0.0001 ||
      state.flipX ||
      state.flipY
    );
  }

  function displayAngle(deg) {
    let a = ((deg % 360) + 360) % 360;
    if (a > 180) a -= 360;
    a = round1(a);
    if (a === 0) a = 0;
    return String(a);
  }

  /* ---------- 样式注入 ---------- */

  function injectStyle() {
    const previous = document.getElementById('bili-video-rotate-style');
    if (previous) previous.remove();
    const style = document.createElement('style');
    style.id = 'bili-video-rotate-style';
    style.textContent = [
      'video.' + CLASS_ACTIVE + ' {',
      '  transform: rotate(var(--bvr-angle, 0deg)) scale(var(--bvr-scale, 1)) scaleX(var(--bvr-flip-x, 1)) scaleY(var(--bvr-flip-y, 1)) !important;',
      '  transform-origin: center center !important;',
      '  will-change: transform;',
      '}',
      'video.' + CLASS_ACTIVE + '.' + CLASS_ANIM + ' {',
      '  transition: transform 0.22s ease;',
      '}',
      'video.' + CLASS_ACTIVE + '.' + CLASS_MEASURE + ' {',
      '  transform: none !important;',
      '  transition: none !important;',
      '}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);
  }

  /* ---------- 播放器识别 ---------- */

  function isUsableVideo(video) {
    if (!video || !video.isConnected) return false;
    if (typeof video.getBoundingClientRect !== 'function') return false;
    const rect = video.getBoundingClientRect();
    if (rect.width < 16 || rect.height < 16) return false;
    let cs = null;
    try {
      cs = window.getComputedStyle(video);
    } catch (err) {
      return true;
    }
    if (!cs) return true;
    if (cs.display === 'none') return false;
    /* WebGL 模式会主动隐藏当前 video，不能因此把它判定为不可用 */
    const webglHidden = video.classList && video.classList.contains(CLASS_WEBGL);
    if (!webglHidden && cs.visibility === 'hidden') return false;
    if (!webglHidden && parseFloat(cs.opacity) === 0) return false;
    return true;
  }

  function collectVideos() {
    const list = [];
    const seen = new Set();
    const push = function (video) {
      if (video && video.tagName === 'VIDEO' && !seen.has(video)) {
        seen.add(video);
        list.push(video);
      }
    };
    document.querySelectorAll('video').forEach(push);
    document.querySelectorAll('bwp-video, #bilibili-player, .bpx-player-container').forEach(function (el) {
      const root = el.shadowRoot;
      if (root) root.querySelectorAll('video').forEach(push);
    });
    return list;
  }

  function layoutArea(video) {
    const width = video.offsetWidth || video.clientWidth || 0;
    const height = video.offsetHeight || video.clientHeight || 0;
    const area = width * height;
    if (area > 0) return area;
    try {
      const rect = video.getBoundingClientRect();
      return rect.width * rect.height;
    } catch (err) {
      return 0;
    }
  }

  function findActivePlayer(preferred) {
    let best = null;
    let bestArea = 0;
    const areas = new Map();

    collectVideos().forEach(function (video) {
      if (!isUsableVideo(video)) return;
      /* 旋转/缩放会放大包围盒，这里只比布局尺寸 */
      const area = layoutArea(video);
      areas.set(video, area);
      if (area > bestArea) {
        bestArea = area;
        best = video;
      }
    });

    if (!best) return null;

    /* 主视频与预览视频面积接近时保持原选择，避免来回切换抖动 */
    if (preferred && preferred !== best && isUsableVideo(preferred)) {
      const preferredArea = areas.has(preferred) ? areas.get(preferred) : layoutArea(preferred);
      if (preferredArea >= bestArea * 0.8) best = preferred;
    }

    const video = best;
    /* 迷你播放器的根节点是 fixed 小窗口，而 #bilibili-player 可能已滚出屏幕 */
    const mini = video.closest('.bpx-player-container[data-screen="mini"]');
    const player =
      mini ||
      video.closest('#bilibili-player') ||
      video.closest('.bpx-player-container') ||
      null;

    const candidates = [];
    const videoArea = video.closest('.bpx-player-video-area');
    if (videoArea) candidates.push(videoArea);
    const videoWrap = video.closest('.bpx-player-video-wrap');
    if (videoWrap) candidates.push(videoWrap);
    if (video.parentElement) candidates.push(video.parentElement);
    if (player) candidates.push(player);

    let container = null;
    for (let i = 0; i < candidates.length; i += 1) {
      const el = candidates[i];
      if (el && el.clientWidth > 0 && el.clientHeight > 0) {
        container = el;
        break;
      }
    }
    if (!container) container = player || video.parentElement || document.body;

    return { player: player || container, container: container, video: video };
  }

  /* ---------- 变换引擎 ---------- */

  let activePlayer = null;
  let rafId = 0;
  let trackedVideo = null;
  let trackedUrl = window.location.href;
  let trackedMedia = null;
  let resetReason = '';
  let metrics = null;
  let animTimer = 0;
  let animateNext = false;
  let instantNext = false;
  /* 本视频内 WebGL 回退后不再重试；换视频时重置 */
  let webglBlocked = false;
  let webglFallbackReason = '';
  let webglSkipReasonCurrent = '';
  const stats = { updates: 0, writes: 0, measures: 0 };

  function scheduleUpdate(animate) {
    /* 非动画请求优先于已排队的动画，避免镜像切换继承旋转的过渡 */
    if (animate) {
      animateNext = true;
      instantNext = false;
    } else {
      instantNext = true;
    }
    if (rafId) return;
    rafId = window.requestAnimationFrame(function () {
      rafId = 0;
      const animated = animateNext && !instantNext;
      animateNext = false;
      instantNext = false;
      updateTransform(animated);
    });
  }

  function cancelAnim(video) {
    if (animTimer) {
      window.clearTimeout(animTimer);
      animTimer = 0;
    }
    if (!video) return;
    try {
      video.classList.remove(CLASS_ANIM);
    } catch (err) {
      /* 元素已失效时忽略 */
    }
  }

  function startAnimTimer(video) {
    if (animTimer) window.clearTimeout(animTimer);
    animTimer = window.setTimeout(function () {
      animTimer = 0;
      if (!video || !video.isConnected) return;
      try {
        video.classList.remove(CLASS_ANIM);
      } catch (err) {
        /* 元素已失效时忽略 */
      }
    }, 260);
  }

  function measureVideoBox(video) {
    if (!video || typeof video.getBoundingClientRect !== 'function') return null;
    let rect = null;
    video.classList.add(CLASS_MEASURE);
    try {
      rect = video.getBoundingClientRect();
    } finally {
      video.classList.remove(CLASS_MEASURE);
    }
    return rect;
  }

  function getPictureBox(video, boxRect) {
    const box = {
      left: boxRect.left,
      top: boxRect.top,
      width: boxRect.width,
      height: boxRect.height
    };
    if (box.width <= 0 || box.height <= 0) return box;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return box;

    let objectFit = 'contain';
    try {
      objectFit = String(window.getComputedStyle(video).objectFit || 'contain').toLowerCase();
    } catch (err) {
      objectFit = 'contain';
    }

    if (objectFit !== 'contain') return box;

    const scale = Math.min(box.width / vw, box.height / vh);
    if (!isFinite(scale) || scale <= 0) return box;

    const picW = vw * scale;
    const picH = vh * scale;

    return {
      left: box.left + (box.width - picW) / 2,
      top: box.top + (box.height - picH) / 2,
      width: picW,
      height: picH
    };
  }

  /* WebGL Phase 1 只支持居中的 object-position */
  function isCenteredObjectPosition(value) {
    const text = String(value || '').toLowerCase().trim();
    if (!text || text === 'center' || text === 'center center') return true;
    return text.split(/\s+/).every(function (part) {
      return part === 'center' || part === '50%';
    });
  }

  function resolveStage(player, boxRect) {
    if (isImmersive()) {
      return {
        left: 0,
        top: 0,
        width: window.innerWidth,
        height: window.innerHeight,
        source: 'viewport'
      };
    }

    const container = player && player.container;
    let rect = null;
    if (container && typeof container.getBoundingClientRect === 'function') {
      rect = container.getBoundingClientRect();
    }
    /* 回退到未变换的 video 盒子，不能用变换后的包围盒当基准 */
    if ((!rect || rect.width < 1 || rect.height < 1) && boxRect && boxRect.width >= 1 && boxRect.height >= 1) {
      rect = boxRect;
    }
    if (!rect || rect.width < 1 || rect.height < 1) {
      return {
        left: 0,
        top: 0,
        width: window.innerWidth,
        height: window.innerHeight,
        source: 'viewport'
      };
    }

    let left = rect.left;
    let top = rect.top;
    let right = rect.right;
    let bottom = rect.bottom;

    const root = player && player.player;
    if (root && root !== container && typeof root.getBoundingClientRect === 'function') {
      const rootRect = root.getBoundingClientRect();
      if (rootRect.width > 0 && rootRect.height > 0) {
        /* 交集为空时保留容器自身（迷你根节点可能位于离屏位置），不能回退整个视口 */
        const nextLeft = Math.max(left, rootRect.left);
        const nextTop = Math.max(top, rootRect.top);
        const nextRight = Math.min(right, rootRect.right);
        const nextBottom = Math.min(bottom, rootRect.bottom);
        if (nextRight - nextLeft >= 1 && nextBottom - nextTop >= 1) {
          left = nextLeft;
          top = nextTop;
          right = nextRight;
          bottom = nextBottom;
        }
      }
    }

    /* 不夹到视口：缩放只依赖宽高，滚动时 stage 尺寸应保持完整 */
    if (right - left < 1 || bottom - top < 1) {
      return {
        left: 0,
        top: 0,
        width: window.innerWidth,
        height: window.innerHeight,
        source: 'viewport'
      };
    }

    return {
      left: left,
      top: top,
      width: right - left,
      height: bottom - top,
      source: 'container'
    };
  }

  function layoutSize(el) {
    if (!el) return { width: 0, height: 0 };
    return {
      width: el.offsetWidth || el.clientWidth || 0,
      height: el.offsetHeight || el.clientHeight || 0
    };
  }

  /* 只记录尺寸类信息，纯滚动不会改变签名 */
  function layoutSignature(player, video, stage) {
    const size = layoutSize(video);
    let objectFit = 'contain';
    let objectPosition = '';
    try {
      const cs = window.getComputedStyle(video);
      objectFit = String(cs.objectFit || 'contain').toLowerCase();
      objectPosition = String(cs.objectPosition || '').toLowerCase();
    } catch (err) {
      objectFit = 'contain';
      objectPosition = '';
    }
    return {
      stageW: stage ? stage.width : 0,
      stageH: stage ? stage.height : 0,
      videoW: size.width,
      videoH: size.height,
      intrinsicW: video.videoWidth || 0,
      intrinsicH: video.videoHeight || 0,
      objectFit: objectFit,
      objectPosition: objectPosition,
      immersive: isImmersive()
    };
  }

  function nearSize(a, b) {
    return Math.abs(a - b) < 0.5;
  }

  /* 只用只读布局信息比较；绝不能调用 measureVideoBox()，否则会打断过渡动画 */
  function isMetricsCurrent(player, video) {
    if (!metrics || !metrics.signature) return false;
    const stage = resolveStage(player, null);
    const next = layoutSignature(player, video, stage);
    const prev = metrics.signature;
    return (
      nearSize(prev.stageW, next.stageW) &&
      nearSize(prev.stageH, next.stageH) &&
      nearSize(prev.videoW, next.videoW) &&
      nearSize(prev.videoH, next.videoH) &&
      prev.intrinsicW === next.intrinsicW &&
      prev.intrinsicH === next.intrinsicH &&
      prev.objectFit === next.objectFit &&
      prev.objectPosition === next.objectPosition &&
      prev.immersive === next.immersive
    );
  }

  function computeScale(picture, stage, angle) {
    const picW = picture.width;
    const picH = picture.height;
    const sw = stage.width;
    const sh = stage.height;
    let fit = 1;

    if (angle % 180 !== 0 && picW > 0 && picH > 0 && sw > 0 && sh > 0) {
      const rad = (Math.abs(angle) * Math.PI) / 180;
      const cos = Math.abs(Math.cos(rad));
      const sin = Math.abs(Math.sin(rad));
      const bw = picW * cos + picH * sin;
      const bh = picW * sin + picH * cos;
      if (bw > 0 && bh > 0) {
        fit = state.fit === 'contain'
          ? Math.min(sw / bw, sh / bh)
          : Math.max(sw / bw, sh / bh);
      }
    }

    return fit * state.zoom;
  }

  function applyVars(video, angleText, scaleText, flipXText, flipYText) {
    let writes = 0;
    try {
      if (video.style.getPropertyValue('--bvr-angle').trim() !== angleText) {
        video.style.setProperty('--bvr-angle', angleText);
        writes += 1;
      }
      if (video.style.getPropertyValue('--bvr-scale').trim() !== scaleText) {
        video.style.setProperty('--bvr-scale', scaleText);
        writes += 1;
      }
      if (video.style.getPropertyValue('--bvr-flip-x').trim() !== flipXText) {
        video.style.setProperty('--bvr-flip-x', flipXText);
        writes += 1;
      }
      if (video.style.getPropertyValue('--bvr-flip-y').trim() !== flipYText) {
        video.style.setProperty('--bvr-flip-y', flipYText);
        writes += 1;
      }
    } catch (err) {
      /* 元素已失效时忽略 */
    }
    stats.writes += writes;
  }

  function updateTransform(animate) {
    const current = activePlayer;
    if (!current || !current.video || !current.video.isConnected) {
      cancelAnim();
      if (renderer.active) renderer.deactivate();
      return;
    }

    const video = current.video;

    if (!isTransformActive()) {
      cancelAnim(video);
      clearVideoStyles(video);
      metrics = null;
      if (renderer.active) renderer.deactivate();
      return;
    }

    /* 只有布局类更新才重新测量；手动操作在布局签名未变时复用尺寸，避免动画期间测量 */
    if (animate !== true || !metrics || !isMetricsCurrent(current, video)) {
      cancelAnim(video);
      const boxRect = measureVideoBox(video);
      if (!boxRect || boxRect.width < 1 || boxRect.height < 1) {
        /* 测量失败时保留上一次变换，不要清空再恢复，否则会闪一下 */
        stats.updates += 1;
        return;
      }
      const stage = resolveStage(current, boxRect);
      metrics = {
        picture: getPictureBox(video, boxRect),
        stage: stage
      };
      metrics.signature = layoutSignature(current, video, stage);
      stats.measures += 1;
    }

    let useWebgl = prefs.renderMode === 'webgl' && !webglBlocked;
    let webglSkipReason = '';
    if (useWebgl) {
      const signature = metrics.signature || {};
      const objectFit = String(signature.objectFit || 'contain');
      /* contain 与 fill 都能用画面矩形直接映射；cover/scale-down 需要额外裁剪逻辑 */
      if (objectFit !== 'contain' && objectFit !== 'fill') {
        useWebgl = false;
        webglSkipReason = 'object-fit:' + objectFit;
      } else if (!isCenteredObjectPosition(signature.objectPosition)) {
        useWebgl = false;
        webglSkipReason = 'object-position:' + (signature.objectPosition || '');
      } else if (state.fit !== 'contain') {
        useWebgl = false;
        webglSkipReason = 'fit:cover';
      } else if (
        !metrics.stage ||
        metrics.stage.width < 16 ||
        metrics.stage.height < 16 ||
        !metrics.picture ||
        metrics.picture.width < 1 ||
        metrics.picture.height < 1
      ) {
        useWebgl = false;
        webglSkipReason = 'stage-size';
      }
    }
    webglSkipReasonCurrent = webglSkipReason;

    if (useWebgl) {
      /* WebGL 路径不能残留 CSS transform / 类，否则两条路径会互相覆盖 */
      cancelAnim(video);
      clearVideoStyles(video);
      if (renderer.activate(current, metrics, currentAngle())) {
        stats.updates += 1;
        return;
      }
      /* 激活失败时 fallbackWebgl 已记录原因并安排下一次 CSS 更新，这里继续走 CSS */
    } else if (renderer.active) {
      renderer.deactivate();
    }

    const angle = currentAngle();
    const scale = computeScale(metrics.picture, metrics.stage, angle);
    const angleText = round1(angle) + 'deg';
    const scaleText = String(Math.round(scale * 10000) / 10000);
    const flipXText = state.flipX ? '-1' : '1';
    const flipYText = state.flipY ? '-1' : '1';

    try {
      if (animate === true) {
        if (!video.classList.contains(CLASS_ACTIVE)) {
          video.classList.add(CLASS_ACTIVE);
          void video.offsetWidth;
        }
        if (!video.classList.contains(CLASS_ANIM)) {
          video.classList.add(CLASS_ANIM);
          void video.offsetWidth;
        }
        startAnimTimer(video);
      } else {
        cancelAnim(video);
        if (!video.classList.contains(CLASS_ACTIVE)) video.classList.add(CLASS_ACTIVE);
      }
    } catch (err) {
      /* 元素已失效时忽略 */
    }

    applyVars(video, angleText, scaleText, flipXText, flipYText);

    stats.updates += 1;
  }

  function clearVideoStyles(video) {
    if (!video) return;
    try {
      video.classList.remove(CLASS_ACTIVE);
      video.classList.remove(CLASS_ANIM);
      video.classList.remove(CLASS_MEASURE);
      video.style.removeProperty('--bvr-angle');
      video.style.removeProperty('--bvr-scale');
      video.style.removeProperty('--bvr-flip-x');
      video.style.removeProperty('--bvr-flip-y');
    } catch (err) {
      /* 元素已失效时忽略 */
    }
  }

  /* ---------- WebGL 渲染器（实验） ---------- */

  const WEBGL_CONTEXT_ATTRS = {
    alpha: false,
    depth: false,
    stencil: false,
    antialias: false,
    premultipliedAlpha: true,
    /* 不保留 drawing buffer：保留会带来每帧额外拷贝，明显增加 GPU 负担；
       改为持续 rAF 从缓存纹理重绘，效果相同且不会合成到空 buffer */
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance'
  };
  const WEBGL_DPR_MAX = 2;

  /* 顶点坐标使用画面局部的 ±1 单位盒，y 轴向下，与 CSS rotate() 方向一致 */
  const WEBGL_VERTEX_SRC = [
    'attribute vec2 a_pos;',
    'attribute vec2 a_uv;',
    'uniform vec2 u_stage;',
    'uniform vec2 u_origin;',
    'uniform vec2 u_picSize;',
    'uniform vec2 u_flip;',
    'uniform float u_scale;',
    'uniform float u_angle;',
    'varying vec2 v_uv;',
    'void main() {',
    '  vec2 local = a_pos * (u_picSize * 0.5) * u_scale * u_flip;',
    '  float c = cos(u_angle);',
    '  float s = sin(u_angle);',
    '  vec2 p = vec2(local.x * c - local.y * s, local.x * s + local.y * c) + u_origin;',
    '  vec2 clip = vec2(p.x / u_stage.x * 2.0 - 1.0, 1.0 - p.y / u_stage.y * 2.0);',
    '  gl_Position = vec4(clip, 0.0, 1.0);',
    '  v_uv = a_uv;',
    '}'
  ].join('\n');

  /* 不做 UNPACK_FLIP_Y：纹理第 0 行对应视频顶部，UV 的 v=0 取顶部 */
  const WEBGL_FRAGMENT_SRC = [
    'precision mediump float;',
    'uniform sampler2D u_tex;',
    'varying vec2 v_uv;',
    'void main() {',
    '  gl_FragColor = texture2D(u_tex, v_uv);',
    '}'
  ].join('\n');

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error('shader: ' + log);
    }
    return shader;
  }

  function isPositionedElement(el) {
    if (!el || el.nodeType !== 1) return false;
    try {
      const position = window.getComputedStyle(el).position;
      return !!position && position !== 'static';
    } catch (err) {
      return false;
    }
  }

  /* 插到 video 所在分支之后：canvas 盖住 video，但仍在弹幕/字幕/控制条之下 */
  function insertCanvasIntoHost(host, canvas, video) {
    let branch = video;
    while (branch && branch.parentNode !== host) {
      branch = branch.parentNode;
    }
    if (branch && branch.parentNode === host) {
      host.insertBefore(canvas, branch.nextSibling);
    } else {
      host.appendChild(canvas);
    }
  }

  function videoHasMediaKeys(video) {
    try {
      return !!(video && (video.mediaKeys || video.webkitMediaKeys || video.msKeys));
    } catch (err) {
      return false;
    }
  }

  const renderer = {
    active: false,
    canvas: null,
    gl: null,
    program: null,
    quadBuffer: null,
    quadUvBuffer: null,
    texture: null,
    locations: null,
    glInfo: null,
    texWidth: 0,
    texHeight: 0,
    lastUploadOk: false,
    video: null,
    player: null,
    host: null,
    hostMode: '',
    stage: null,
    originX: 0,
    originY: 0,
    picW: 0,
    picH: 0,
    angle: 0,
    angleRad: 0,
    scale: 1,
    flipX: 1,
    flipY: 1,
    saved: null,
    hiddenMode: '',
    /* 首帧绘制成功前 canvas 保持隐藏、video 保持可见，避免先黑屏再出画 */
    hasFrame: false,
    revealed: false,
    needsRedraw: false,
    geometryKey: '',
    lastDrawAt: 0,
    /* 诊断计数：确认闪烁时是否仍在走 WebGL、是否发生重挂或重复激活 */
    activations: 0,
    rehosts: 0,
    canvasRemovals: 0,
    reveals: 0,
    emptyUploads: 0,
    frames: 0,
    draws: 0,
    uploads: 0,
    uploadMs: 0,
    drawMs: 0,
    lastGlError: 0,
    fallbackReason: '',
    blackProbes: 0,
    blackFrames: 0,
    blackProbeDone: false,
    frameTimer: 0,
    rvfcId: 0,
    rvfcPending: false,
    rafId: 0,
    drawRafId: 0,
    boundScroll: null,
    scrollBound: false,
    boundContextLost: null,
    disposing: false,
    listeners: null,

    createCanvas: function () {
      if (this.canvas) return this.canvas;
      const canvas = document.createElement('canvas');
      canvas.id = 'bvr-webgl-canvas';
      canvas.className = CLASS_CANVAS;
      canvas.style.cssText =
        'position:absolute;left:0;top:0;width:0;height:0;display:none;pointer-events:none;background:#000;';
      this.canvas = canvas;
      return canvas;
    },

    initGL: function () {
      if (this.gl) return true;
      const canvas = this.canvas;
      let gl = null;
      try {
        gl =
          canvas.getContext('webgl2', WEBGL_CONTEXT_ATTRS) ||
          canvas.getContext('webgl', WEBGL_CONTEXT_ATTRS) ||
          canvas.getContext('experimental-webgl', WEBGL_CONTEXT_ATTRS);
      } catch (err) {
        gl = null;
      }
      if (!gl) {
        this.fallbackReason = 'no-context';
        return false;
      }

      let program = null;
      try {
        const vs = compileShader(gl, gl.VERTEX_SHADER, WEBGL_VERTEX_SRC);
        const fs = compileShader(gl, gl.FRAGMENT_SHADER, WEBGL_FRAGMENT_SRC);
        program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
          const log = gl.getProgramInfoLog(program);
          gl.deleteProgram(program);
          throw new Error('link: ' + log);
        }
      } catch (err) {
        this.fallbackReason = 'shader';
        return false;
      }

      this.gl = gl;
      this.program = program;
      this.locations = {
        pos: gl.getAttribLocation(program, 'a_pos'),
        uv: gl.getAttribLocation(program, 'a_uv'),
        stage: gl.getUniformLocation(program, 'u_stage'),
        origin: gl.getUniformLocation(program, 'u_origin'),
        picSize: gl.getUniformLocation(program, 'u_picSize'),
        flip: gl.getUniformLocation(program, 'u_flip'),
        scale: gl.getUniformLocation(program, 'u_scale'),
        angle: gl.getUniformLocation(program, 'u_angle'),
        tex: gl.getUniformLocation(program, 'u_tex')
      };
      this.quadBuffer = gl.createBuffer();
      this.quadUvBuffer = gl.createBuffer();
      this.texture = null;
      this.texWidth = 0;
      this.texHeight = 0;
      this.lastUploadOk = false;

      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        gl.STATIC_DRAW
      );
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadUvBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
        gl.STATIC_DRAW
      );

      try {
        this.glInfo = {
          version: String(gl.getParameter(gl.VERSION) || ''),
          renderer: String(gl.getParameter(gl.RENDERER) || ''),
          vendor: String(gl.getParameter(gl.VENDOR) || ''),
          attributes: gl.getContextAttributes ? gl.getContextAttributes() : null
        };
      } catch (err) {
        this.glInfo = null;
      }

      if (!this.boundContextLost) this.boundContextLost = this.onContextLost.bind(this);
      try {
        canvas.addEventListener('webglcontextlost', this.boundContextLost, false);
      } catch (err) {}
      return true;
    },

    onContextLost: function (event) {
      try {
        event.preventDefault();
      } catch (err) {}
      /* destroy() 主动释放上下文时也会触发该事件，不能当作异常回退 */
      if (this.disposing) return;
      this.fallback('context-lost');
    },

    saveInlineProps: function () {
      if (!this.video || this.saved) return;
      const video = this.video;
      const saved = {};
      ['visibility', 'opacity', 'pointer-events'].forEach(function (name) {
        saved[name] = {
          value: video.style.getPropertyValue(name),
          priority: video.style.getPropertyPriority(name)
        };
      });
      this.saved = saved;
    },

    restoreInlineProps: function () {
      if (!this.video || !this.saved) return;
      const video = this.video;
      const saved = this.saved;
      ['visibility', 'opacity', 'pointer-events'].forEach(function (name) {
        const item = saved[name];
        try {
          if (item && item.value) video.style.setProperty(name, item.value, item.priority || '');
          else video.style.removeProperty(name);
        } catch (err) {}
      });
    },

    /* visibility 优先；若隐藏后取不到新帧，改用 opacity:0 再试 */
    setHiddenMode: function (mode) {
      const video = this.video;
      if (!video) return;
      if (this.hiddenMode === mode) return;
      this.hiddenMode = mode;
      this.restoreInlineProps();
      try {
        video.classList.add(CLASS_WEBGL);
        if (mode === 'visibility') {
          video.style.setProperty('visibility', 'hidden', 'important');
        } else if (mode === 'opacity') {
          video.style.setProperty('opacity', '0', 'important');
          video.style.setProperty('pointer-events', 'none', 'important');
        }
      } catch (err) {}
    },

    chooseHost: function (player) {
      const video = player.video;
      const container = player.container;
      const playerRoot = player.player;

      let root = null;
      try {
        root = video.getRootNode();
      } catch (err) {
        root = null;
      }
      const sameRoot = function (el) {
        if (!el || el.nodeType !== 1) return false;
        if (!root) return true;
        try {
          return el.getRootNode() === root;
        } catch (err) {
          return false;
        }
      };

      let el = container;
      let steps = 0;
      while (sameRoot(el) && steps < 40) {
        if (isPositionedElement(el)) return { host: el, mode: 'absolute' };
        if (playerRoot && el === playerRoot) break;
        if (el === document.body || el === document.documentElement) break;
        el = el.parentElement;
        steps += 1;
      }

      /* 从 video 的父级开始，绝不能把 <video> 自身当作 canvas 容器 */
      el = video.parentElement;
      steps = 0;
      while (sameRoot(el) && steps < 40) {
        if (isPositionedElement(el)) return { host: el, mode: 'absolute' };
        if (playerRoot && el === playerRoot) break;
        if (el === document.body || el === document.documentElement) break;
        el = el.parentElement;
        steps += 1;
      }

      /* 回退到与 video 相同的树，避免 canvas 落在 shadow root 之外 */
      let fixedHost = root && root.nodeType === 11 && root.host ? root : document.body;

      /* 原生全屏时 canvas 必须位于全屏元素内部，否则不会被渲染 */
      const fullscreen = getFullscreenElement();
      if (fullscreen && fullscreen.nodeType === 1) {
        const anchor = root && root.nodeType === 11 && root.host ? root.host : video;
        try {
          if (fullscreen.contains(anchor)) fixedHost = fullscreen;
        } catch (err) {}
      }

      return { host: fixedHost, mode: 'fixed' };
    },

    ensureHost: function (player) {
      const canvas = this.canvas;
      if (!canvas) return false;
      const desc = this.chooseHost(player);
      let host = desc.host;
      let mode = desc.mode;
      const changed =
        this.host !== host ||
        this.hostMode !== mode ||
        canvas.parentNode !== host ||
        !canvas.isConnected;

      if (changed) {
        /* 已经挂载过说明是重挂（播放器重渲染 / 全屏切换），不是首次挂载 */
        const wasMounted = !!(this.active && this.host);
        try {
          if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        } catch (err) {}
        try {
          if (mode === 'absolute' && host.nodeType === 1) {
            insertCanvasIntoHost(host, canvas, player.video);
          } else {
            mode = 'fixed';
            host.appendChild(canvas);
          }
        } catch (err) {
          try {
            host = document.body;
            mode = 'fixed';
            host.appendChild(canvas);
          } catch (err2) {}
        }
        this.host = host;
        this.hostMode = mode;
        if (wasMounted) this.rehosts += 1;
        /* 重挂后 backing store 可能与舞台尺寸不一致，要求下一次激活重绘 */
        this.needsRedraw = true;
      }

      this.updateHostBindings(this.hostMode);
      return changed;
    },

    updateHostBindings: function (mode) {
      if (mode === 'fixed' && !this.scrollBound) {
        if (!this.boundScroll) this.boundScroll = this.handleScroll.bind(this);
        try {
          window.addEventListener('scroll', this.boundScroll, true);
          this.scrollBound = true;
        } catch (err) {}
      } else if (mode !== 'fixed' && this.scrollBound) {
        try {
          window.removeEventListener('scroll', this.boundScroll, true);
        } catch (err) {}
        this.scrollBound = false;
      }
    },

    handleScroll: function () {
      if (this.active && this.hostMode === 'fixed') this.reposition();
    },

    applyGeometry: function (metrics, angle) {
      if (!metrics || !metrics.picture || !metrics.stage) return false;
      const picture = metrics.picture;
      const stage = metrics.stage;
      const originX = picture.left - stage.left + picture.width / 2;
      const originY = picture.top - stage.top + picture.height / 2;
      const scale = computeScale(picture, stage, angle);
      const flipX = state.flipX ? -1 : 1;
      const flipY = state.flipY ? -1 : 1;

      /* 轻量几何签名：未变化时跳过重复纹理上传与绘制 */
      const key = [
        round1(stage.width),
        round1(stage.height),
        round1(originX),
        round1(originY),
        round1(picture.width),
        round1(picture.height),
        round1(angle),
        Math.round(scale * 10000) / 10000,
        flipX,
        flipY
      ].join('|');
      const changed = key !== this.geometryKey;

      this.stage = stage;
      this.angle = angle;
      this.angleRad = (angle * Math.PI) / 180;
      this.originX = originX;
      this.originY = originY;
      this.picW = picture.width;
      this.picH = picture.height;
      this.scale = scale;
      this.flipX = flipX;
      this.flipY = flipY;
      this.geometryKey = key;
      return changed;
    },

    reposition: function () {
      const canvas = this.canvas;
      const stage = this.stage;
      if (!canvas || !stage) return;

      let left = stage.left;
      let top = stage.top;

      if (this.player) {
        /* stage 可能因滚动/进入全屏而移动；尺寸以 metrics 快照为准，位置取当前值 */
        const fresh = resolveStage(this.player, null);
        if (fresh && fresh.width >= 1 && fresh.height >= 1) {
          if (this.hostMode === 'absolute' && this.host && this.host.nodeType === 1) {
            const hostRect = nodeRect(this.host);
            if (hostRect) {
              left = fresh.left - hostRect.left - (this.host.clientLeft || 0);
              top = fresh.top - hostRect.top - (this.host.clientTop || 0);
            }
          } else if (this.hostMode === 'fixed') {
            left = fresh.left;
            top = fresh.top;
          }
        }
      }

      if (!isFinite(left) || !isFinite(top) || stage.width < 1 || stage.height < 1) return;

      const style = canvas.style;
      const leftText = round1(left) + 'px';
      const topText = round1(top) + 'px';
      const widthText = round1(stage.width) + 'px';
      const heightText = round1(stage.height) + 'px';
      if (style.left !== leftText) style.left = leftText;
      if (style.top !== topText) style.top = topText;
      if (style.width !== widthText) style.width = widthText;
      if (style.height !== heightText) style.height = heightText;
      if (style.position !== (this.hostMode === 'fixed' ? 'fixed' : 'absolute')) {
        style.position = this.hostMode === 'fixed' ? 'fixed' : 'absolute';
      }
    },

    resize: function () {
      const canvas = this.canvas;
      const stage = this.stage;
      if (!canvas || !stage) return false;
      const dpr = Math.min(window.devicePixelRatio || 1, WEBGL_DPR_MAX);
      const width = Math.max(1, Math.round(stage.width * dpr));
      const height = Math.max(1, Math.round(stage.height * dpr));
      const changed = canvas.width !== width || canvas.height !== height;
      if (changed) {
        /* 修改 backing store 会清空 drawing buffer，调用方必须在同一任务内重绘 */
        canvas.width = width;
        canvas.height = height;
      }
      return changed;
    },

    uploadFrame: function () {
      const video = this.video;
      const gl = this.gl;
      if (!video || !gl) return false;
      if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return false;

      const started = performance.now();
      try {
        if (!this.texture) {
          this.texture = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, this.texture);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        } else {
          gl.bindTexture(gl.TEXTURE_2D, this.texture);
        }

        if (this.texWidth !== video.videoWidth || this.texHeight !== video.videoHeight) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
          this.texWidth = video.videoWidth;
          this.texHeight = video.videoHeight;
        } else {
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, video);
        }
      } catch (err) {
        /* 跨域 / DRM / 上下文丢失：交给回退逻辑 */
        try {
          this.lastGlError = gl.getError();
        } catch (err2) {}
        this.fallback('texture');
        return false;
      }

      this.uploads += 1;
      this.uploadMs += performance.now() - started;
      this.lastUploadOk = true;
      /* getError 会打断 GPU 流水线，只在异常时或低频抽样时查询 */
      if (this.uploads % 120 === 0) {
        try {
          const error = gl.getError();
          if (error !== gl.NO_ERROR) this.lastGlError = error;
        } catch (err) {}
      }
      return true;
    },

    renderFrame: function () {
      if (!this.active) return;
      const gl = this.gl;
      if (!gl || !this.canvas || !this.stage) return;

      this.frames += 1;
      this.uploadFrame();
      if (!this.active || !this.gl) return;

      /* 还没有任何有效纹理时不要清屏：清屏会把画面擦成黑色 */
      if (!this.texture || !this.lastUploadOk) {
        this.emptyUploads += 1;
        this.noteFrame();
        return;
      }
      /* 当前帧上传失败（readyState/seeking）时保留上一帧纹理继续绘制 */
      this.drawFrame();
      this.probeBlackFrame();
      this.noteFrame();
    },

    /* 只用缓存纹理重绘：drawing buffer 不保留，需要每个显示帧重画一次 */
    drawFrame: function () {
      if (!this.active) return false;
      const gl = this.gl;
      const canvas = this.canvas;
      if (!gl || !canvas || !this.stage) return false;
      if (!this.texture || !this.lastUploadOk) return false;

      const started = performance.now();
      try {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        const loc = this.locations;
        gl.useProgram(this.program);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.uniform1i(loc.tex, 0);
        gl.uniform2f(loc.stage, this.stage.width, this.stage.height);
        gl.uniform2f(loc.origin, this.originX, this.originY);
        gl.uniform2f(loc.picSize, this.picW, this.picH);
        gl.uniform2f(loc.flip, this.flipX, this.flipY);
        gl.uniform1f(loc.scale, this.scale);
        gl.uniform1f(loc.angle, this.angleRad);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.enableVertexAttribArray(loc.pos);
        gl.vertexAttribPointer(loc.pos, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadUvBuffer);
        gl.enableVertexAttribArray(loc.uv);
        gl.vertexAttribPointer(loc.uv, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } catch (err) {
        this.fallback('draw');
        return false;
      }
      this.draws += 1;
      this.drawMs += performance.now() - started;
      this.lastDrawAt = performance.now();

      /* 首帧成功绘制后才显示 canvas 并隐藏 video */
      this.hasFrame = true;
      if (!this.reveal()) this.needsRedraw = true;
      return true;
    },

    /* 持续 rAF 重绘：避免播放器 UI 重绘 / 重合成时读到已清空的 drawing buffer */
    startDrawLoop: function () {
      if (!this.active || this.drawRafId) return;
      if (document.visibilityState === 'hidden') return;
      const self = this;
      this.drawRafId = window.requestAnimationFrame(function () {
        self.drawRafId = 0;
        if (!self.active) return;
        /* rVFC 刚在同一帧内画过就跳过，避免重复绘制 */
        if (performance.now() - self.lastDrawAt >= 3) self.drawFrame();
        self.startDrawLoop();
      });
    },

    stopDrawLoop: function () {
      if (!this.drawRafId) return;
      try {
        window.cancelAnimationFrame(this.drawRafId);
      } catch (err) {}
      this.drawRafId = 0;
    },

    /* 先显示已画好内容的 canvas，再隐藏 video；重复调用不会反复切换 */
    reveal: function () {
      if (!this.active || !this.canvas || !this.canvas.isConnected) return false;
      if (!this.revealed) {
        this.revealed = true;
        this.reveals += 1;
      }
      if (this.canvas.style.display !== 'block') {
        try {
          this.canvas.style.display = 'block';
        } catch (err) {}
      }
      /* 已经因取不到帧降级到 opacity:0 时不要来回切回 visibility */
      this.setHiddenMode(this.hiddenMode || 'visibility');
      return true;
    },

    scheduleFrame: function () {
      if (!this.active || this.rvfcPending || this.rafId) return;
      const video = this.video;
      if (!video || document.visibilityState === 'hidden') return;

      const requestFrame =
        video.requestVideoFrameCallback || video.webkitRequestVideoFrameCallback;
      if (typeof requestFrame === 'function') {
        const self = this;
        this.rvfcPending = true;
        this.rvfcId = requestFrame.call(video, function () {
          self.rvfcPending = false;
          self.rvfcId = 0;
          if (!self.active) return;
          self.renderFrame();
          if (self.active && self.video && !self.video.paused) self.scheduleFrame();
        });
        return;
      }

      const self = this;
      this.rafId = window.requestAnimationFrame(function () {
        self.rafId = 0;
        if (!self.active) return;
        self.renderFrame();
        if (self.active && self.video && !self.video.paused) self.scheduleFrame();
      });
    },

    stopLoop: function () {
      const video = this.video;
      const cancelFrame =
        video && (video.cancelVideoFrameCallback || video.webkitCancelVideoFrameCallback);
      if (this.rvfcId && typeof cancelFrame === 'function') {
        try {
          cancelFrame.call(video, this.rvfcId);
        } catch (err) {}
      }
      this.rvfcId = 0;
      this.rvfcPending = false;
      if (this.rafId) {
        try {
          window.cancelAnimationFrame(this.rafId);
        } catch (err) {}
        this.rafId = 0;
      }
      if (this.frameTimer) {
        window.clearTimeout(this.frameTimer);
        this.frameTimer = 0;
      }
    },

    startWatchdog: function () {
      const video = this.video;
      if (!this.active || !video || video.paused || document.visibilityState === 'hidden') return;
      if (this.frameTimer) window.clearTimeout(this.frameTimer);
      const self = this;
      this.frameTimer = window.setTimeout(function () {
        self.frameTimer = 0;
        if (!self.active) return;
        const current = self.video;
        if (!current || current.paused || document.visibilityState === 'hidden') return;
        if (current.readyState < 3 || current.seeking) {
          self.startWatchdog();
          return;
        }
        /* 纯音频 / 无法取到画面尺寸时没有可渲染内容 */
        if (!current.videoWidth || !current.videoHeight) {
          self.fallback('no-dimensions');
          return;
        }
        if (self.hiddenMode === 'visibility') {
          /* 隐藏元素可能不再产出视频帧，退一步用 opacity:0 保持合成 */
          self.setHiddenMode('opacity');
          /* 旧的 rVFC 可能永远不会触发，先取消再重新排队 */
          self.stopLoop();
          self.scheduleFrame();
          self.startWatchdog();
          return;
        }
        self.fallback('no-frames');
      }, 2000);
    },

    noteFrame: function () {
      if (!this.active) return;
      if (this.frameTimer) {
        window.clearTimeout(this.frameTimer);
        this.frameTimer = 0;
      }
      this.startWatchdog();
    },

    /* 首次播放后低频抽样画面中心，连续全黑视为 DRM/纹理异常 */
    probeBlackFrame: function () {
      if (this.blackProbeDone || !this.lastUploadOk || !this.gl) return;
      this.blackProbes += 1;
      if (this.blackProbes < 15 || this.blackProbes % 15 !== 0) return;
      if (this.blackProbes > 150) {
        this.blackProbeDone = true;
        return;
      }

      const gl = this.gl;
      const canvas = this.canvas;
      const stage = this.stage;
      if (!canvas || !stage || stage.width < 1 || stage.height < 1) return;

      const c = Math.cos(this.angleRad);
      const s = Math.sin(this.angleRad);
      const halfW = this.picW / 2;
      const halfH = this.picH / 2;
      const locals = [
        [0, 0],
        [halfW * 0.5, 0],
        [-halfW * 0.5, 0],
        [0, halfH * 0.5],
        [0, -halfH * 0.5]
      ];
      const buffer = new Uint8Array(4);
      let lit = false;

      try {
        for (let i = 0; i < locals.length; i += 1) {
          const lx = locals[i][0] * this.scale * this.flipX;
          const ly = locals[i][1] * this.scale * this.flipY;
          const x = lx * c - ly * s + this.originX;
          const y = lx * s + ly * c + this.originY;
          const px = Math.round((x / stage.width) * canvas.width);
          const py = Math.round(canvas.height - (y / stage.height) * canvas.height);
          const cx = clamp(px, 0, canvas.width - 1);
          const cy = clamp(py, 0, canvas.height - 1);
          gl.readPixels(cx, cy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
          if (buffer[0] > 6 || buffer[1] > 6 || buffer[2] > 6) {
            lit = true;
            break;
          }
        }
      } catch (err) {
        this.blackProbeDone = true;
        return;
      }

      if (lit) {
        this.blackProbeDone = true;
        this.blackFrames = 0;
        return;
      }

      this.blackFrames += 1;
      /* EME 受保护内容直接回退；普通视频需连续约 4 秒全黑才算异常 */
      if (videoHasMediaKeys(this.video) || this.blackFrames >= 8) {
        this.fallback('black-frames');
      }
    },

    attachMedia: function () {
      if (this.listeners || !this.video) return;
      const video = this.video;
      const self = this;
      this.listeners = {
        play: function () {
          if (!self.active) return;
          self.startDrawLoop();
          self.startWatchdog();
          self.scheduleFrame();
        },
        playing: function () {
          if (!self.active) return;
          self.startDrawLoop();
          self.startWatchdog();
          self.scheduleFrame();
        },
        pause: function () {
          if (!self.active) return;
          self.stopLoop();
          self.renderFrame();
        },
        seeked: function () {
          if (!self.active) return;
          self.renderFrame();
        },
        loadedmetadata: function () {
          if (!self.active) return;
          self.texWidth = 0;
          self.texHeight = 0;
          self.renderFrame();
        },
        loadeddata: function () {
          if (!self.active) return;
          self.renderFrame();
        },
        canplay: function () {
          if (!self.active) return;
          self.renderFrame();
          if (!self.video.paused) self.scheduleFrame();
        },
        durationchange: function () {
          if (!self.active) return;
          self.texWidth = 0;
          self.texHeight = 0;
          self.renderFrame();
        },
        resize: function () {
          if (!self.active) return;
          self.texWidth = 0;
          self.texHeight = 0;
          self.renderFrame();
        }
      };
      Object.keys(this.listeners).forEach(function (name) {
        try {
          video.addEventListener(name, self.listeners[name]);
        } catch (err) {}
      });
    },

    detachMedia: function () {
      const video = this.video;
      const listeners = this.listeners;
      this.listeners = null;
      if (!video || !listeners) return;
      Object.keys(listeners).forEach(function (name) {
        try {
          video.removeEventListener(name, listeners[name]);
        } catch (err) {}
      });
    },

    onHidden: function () {
      this.stopLoop();
      this.stopDrawLoop();
    },

    onVisible: function () {
      if (!this.active) return;
      this.renderFrame();
      this.startDrawLoop();
      if (this.video && !this.video.paused) {
        this.startWatchdog();
        this.scheduleFrame();
      }
    },

    activate: function (player, metrics, angle) {
      this.activations += 1;
      if (this.gl && this.gl.isContextLost && this.gl.isContextLost()) this.destroy();
      const video = player.video;
      const freshVideo = this.video !== video;
      if (this.video && freshVideo) this.destroy();

      this.player = player;
      this.video = video;
      this.createCanvas();
      this.saveInlineProps();

      if (!this.initGL()) {
        this.fallback(this.fallbackReason || 'init');
        return false;
      }

      this.active = true;
      if (freshVideo) {
        this.blackProbes = 0;
        this.blackFrames = 0;
        this.blackProbeDone = false;
        this.hasFrame = false;
        this.revealed = false;
        this.geometryKey = '';
        this.needsRedraw = true;
      }

      /* 几何 / 宿主是幂等的：重复激活只更新，不重复上传纹理 */
      const geometryChanged = this.applyGeometry(metrics, angle);
      this.ensureHost(player);
      if (!this.canvas || !this.canvas.isConnected) {
        this.fallback('host');
        return false;
      }
      /* canvas 先按舞台尺寸定位并调整 backing store，renderFrame 才能安全绘制 */
      this.reposition();
      const resized = this.resize();

      const redraw = this.needsRedraw || resized || geometryChanged || !this.hasFrame || !this.revealed;
      this.needsRedraw = false;
      if (redraw) this.renderFrame();
      if (!this.active) return false;

      this.attachMedia();
      /* 持续重绘与是否播放无关：暂停时 UI 重绘同样需要现成的 canvas 内容 */
      this.startDrawLoop();
      if (!video.paused) this.scheduleFrame();
      return true;
    },

    deactivate: function () {
      this.stopLoop();
      this.stopDrawLoop();
      this.active = false;
      this.detachMedia();
      /* 先恢复 video 可见、再隐藏 canvas，同一任务内完成，避免中间帧露出黑底 */
      this.restoreInlineProps();
      this.hiddenMode = '';
      if (this.video) {
        try {
          this.video.classList.remove(CLASS_WEBGL);
        } catch (err) {}
      }
      if (this.canvas) {
        try {
          this.canvas.style.display = 'none';
        } catch (err) {}
      }
      if (this.scrollBound) {
        try {
          window.removeEventListener('scroll', this.boundScroll, true);
        } catch (err) {}
        this.scrollBound = false;
      }
      this.hasFrame = false;
      this.revealed = false;
      this.geometryKey = '';
      this.needsRedraw = false;
      this.lastDrawAt = 0;
      /* 下次启动时重新记录当时的 inline 样式，避免覆盖站点期间的改动 */
      this.saved = null;
    },

    destroy: function () {
      this.deactivate();
      this.disposing = true;
      const gl = this.gl;
      const canvas = this.canvas;
      if (gl) {
        try {
          if (this.texture) gl.deleteTexture(this.texture);
          if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
          if (this.quadUvBuffer) gl.deleteBuffer(this.quadUvBuffer);
          if (this.program) gl.deleteProgram(this.program);
          if (!(gl.isContextLost && gl.isContextLost())) {
            const lose = gl.getExtension('WEBGL_lose_context');
            if (lose) lose.loseContext();
          }
        } catch (err) {}
      }
      if (canvas) {
        if (this.boundContextLost) {
          try {
            canvas.removeEventListener('webglcontextlost', this.boundContextLost, false);
          } catch (err) {}
        }
        try {
          if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        } catch (err) {}
      }
      this.canvas = null;
      this.gl = null;
      this.program = null;
      this.locations = null;
      this.quadBuffer = null;
      this.quadUvBuffer = null;
      this.texture = null;
      this.glInfo = null;
      this.texWidth = 0;
      this.texHeight = 0;
      this.lastUploadOk = false;
      this.host = null;
      this.hostMode = '';
      this.video = null;
      this.player = null;
      this.saved = null;
      this.stage = null;
      this.disposing = false;
    },

    fallback: function (reason) {
      this.fallbackReason = reason || this.fallbackReason || 'unknown';
      fallbackWebgl(this.fallbackReason);
    },

    describe: function () {
      const video = this.video;
      let quality = null;
      if (video && typeof video.getVideoPlaybackQuality === 'function') {
        try {
          quality = video.getVideoPlaybackQuality();
        } catch (err) {
          quality = null;
        }
      }
      return {
        active: this.active,
        fallbackReason: this.fallbackReason || webglFallbackReason || '',
        hiddenMode: this.hiddenMode,
        host: this.host
          ? (this.host.nodeType === 11 ? 'shadow-root' : describeNode(this.host))
          : null,
        hostMode: this.hostMode,
        canvas: this.canvas ? describeNode(this.canvas) : null,
        canvasRect: this.canvas ? rectSummary(nodeRect(this.canvas)) : null,
        backingStore: this.canvas ? this.canvas.width + 'x' + this.canvas.height : '',
        dpr: Math.min(window.devicePixelRatio || 1, WEBGL_DPR_MAX),
        texture: this.texWidth && this.texHeight ? this.texWidth + 'x' + this.texHeight : '',
        gl: this.glInfo,
        hasFrame: this.hasFrame,
        revealed: this.revealed,
        activations: this.activations,
        rehosts: this.rehosts,
        canvasRemovals: this.canvasRemovals,
        reveals: this.reveals,
        emptyUploads: this.emptyUploads,
        frames: this.frames,
        draws: this.draws,
        uploads: this.uploads,
        avgUploadMs: this.uploads
          ? Math.round((this.uploadMs / this.uploads) * 100) / 100
          : null,
        avgDrawMs: this.draws
          ? Math.round((this.drawMs / this.draws) * 100) / 100
          : null,
        lastGlError: this.lastGlError,
        videoVisibility: video ? video.style.getPropertyValue('visibility') : '',
        videoOpacity: video ? video.style.getPropertyValue('opacity') : '',
        videoClassActive: video && video.classList ? video.classList.contains(CLASS_ACTIVE) : false,
        videoClassWebgl: video && video.classList ? video.classList.contains(CLASS_WEBGL) : false,
        quality: quality
          ? { total: quality.totalVideoFrames, dropped: quality.droppedVideoFrames }
          : null
      };
    }
  };

  function fallbackWebgl(reason) {
    if (webglBlocked) return;
    webglBlocked = true;
    webglFallbackReason = reason || 'unknown';
    renderer.fallbackReason = webglFallbackReason;
    try {
      console.warn('[bilibili-video-rotate] WebGL 渲染回退到 CSS：' + webglFallbackReason);
    } catch (err) {}
    /* 保留 metrics：本次 updateTransform 仍可继续绘制 CSS 路径 */
    renderer.destroy();
    scheduleUpdate(false);
  }

  /* ---------- 会话状态 ---------- */

  function readSession() {
    try {
      const raw = window.sessionStorage.getItem(KEY_SESSION);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return null;
      if (typeof data.mediaKey !== 'string' || !data.mediaKey) return null;
      if (typeof data.savedAt !== 'number' || !isFinite(data.savedAt)) return null;
      const age = Date.now() - data.savedAt;
      if (age < 0 || age > SESSION_TTL) return null;
      return data;
    } catch (err) {
      return null;
    }
  }

  function clearSession() {
    try {
      window.sessionStorage.removeItem(KEY_SESSION);
    } catch (err) {
      /* sessionStorage 不可用时保持内存态 */
    }
  }

  /* 没有变换时不写键，让「重置」后的会话状态保持干净 */
  function persistSession() {
    if (!isTransformActive()) {
      clearSession();
      return;
    }
    if (!trackedMedia) return;
    try {
      window.sessionStorage.setItem(KEY_SESSION, JSON.stringify({
        mediaKey: trackedMedia,
        quarterTurns: state.quarterTurns,
        fine: state.fine,
        zoom: state.zoom,
        flipX: state.flipX,
        flipY: state.flipY,
        savedAt: Date.now()
      }));
    } catch (err) {
      /* sessionStorage 不可用或写入失败时静默降级 */
    }
  }

  function sessionNumber(value, fallback) {
    const num = typeof value === 'number' ? value : parseFloat(value);
    return isFinite(num) ? num : fallback;
  }

  /* 只在同一标签页、同一视频且未过期时恢复；返回恢复所用的媒体身份 */
  function restoreSession() {
    const saved = readSession();
    if (!saved) return null;
    const current = mediaKey();
    if (!current || saved.mediaKey !== current) return null;

    state.quarterTurns = Math.round(sessionNumber(saved.quarterTurns, 0));
    state.fine = clamp(round1(sessionNumber(saved.fine, 0)), -FINE_LIMIT, FINE_LIMIT);
    if (state.fine === 0) state.fine = 0;
    state.zoom = clamp(sessionNumber(saved.zoom, 1), ZOOM_MIN, ZOOM_MAX);
    state.flipX = !!saved.flipX;
    state.flipY = !!saved.flipY;
    return current;
  }

  function resetTransformState(reason) {
    state.quarterTurns = 0;
    state.fine = 0;
    state.zoom = 1;
    state.flipX = false;
    state.flipY = false;
    resetReason = reason || '';
    clearSession();
  }

  /* ---------- 悬浮 UI ---------- */

  const host = document.createElement('div');
  host.id = APP_ID;
  host.style.cssText =
    'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';

  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = [
    '<style>',
    '  :host { all: initial; }',
    '  * { box-sizing: border-box; }',
    '  .bvr-btn {',
    '    position: relative;',
    '    width: 44px;',
    '    height: 44px;',
    '    padding: 0;',
    '    border: 0;',
    '    border-radius: 50%;',
    '    background: rgba(20, 20, 24, 0.55);',
    '    color: #fff;',
    '    display: flex;',
    '    align-items: center;',
    '    justify-content: center;',
    '    cursor: grab;',
    '    pointer-events: auto;',
    '    opacity: 0.72;',
    '    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);',
    '    backdrop-filter: blur(6px);',
    '    -webkit-backdrop-filter: blur(6px);',
    '    transition: background 0.18s ease, opacity 0.18s ease, box-shadow 0.18s ease;',
    '    touch-action: none;',
    '    -webkit-tap-highlight-color: transparent;',
    '    font: inherit;',
    '  }',
    '  .bvr-btn:hover { opacity: 1; background: rgba(20, 20, 24, 0.82); }',
    '  .bvr-btn:focus-visible { outline: 2px solid #00aeec; outline-offset: 2px; }',
    '  .bvr-btn.bvr-active {',
    '    opacity: 1;',
    '    background: rgba(0, 174, 236, 0.9);',
    '    box-shadow: 0 0 0 2px rgba(0, 174, 236, 0.35), 0 2px 10px rgba(0, 0, 0, 0.35);',
    '  }',
    '  .bvr-btn.bvr-dragging { cursor: grabbing; }',
    '  .bvr-btn svg { width: 22px; height: 22px; display: block; pointer-events: none; }',
    '  .bvr-panel {',
    '    position: fixed;',
    '    width: 236px;',
    '    max-height: calc(100vh - 16px);',
    '    overflow: auto;',
    '    padding: 12px;',
    '    background: rgba(24, 24, 28, 0.97);',
    '    color: #e8e8ee;',
    '    border: 1px solid rgba(255, 255, 255, 0.12);',
    '    border-radius: 10px;',
    '    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);',
    '    font: 12px/1.4 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;',
    '    pointer-events: auto;',
    '  }',
    '  .bvr-panel[hidden] { display: none !important; }',
    '  .bvr-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }',
    '  .bvr-head span { font-weight: 600; font-size: 12px; }',
    '  .bvr-x {',
    '    width: 20px; height: 20px; padding: 0; line-height: 1;',
    '    border: 0; border-radius: 4px; background: transparent; color: #b9b9c4;',
    '    font: 16px/1 sans-serif; cursor: pointer;',
    '  }',
    '  .bvr-x:hover { background: rgba(255, 255, 255, 0.12); color: #fff; }',
    '  .bvr-angle {',
    '    margin: 2px 0 10px;',
    '    text-align: center;',
    '    font-size: 26px;',
    '    font-weight: 600;',
    '    color: #fff;',
    '    font-variant-numeric: tabular-nums;',
    '  }',
    '  .bvr-row { display: flex; gap: 6px; margin-bottom: 8px; }',
    '  .bvr-row:last-child { margin-bottom: 0; }',
    '  .bvr-row button {',
    '    flex: 1 1 0;',
    '    height: 28px;',
    '    padding: 0 4px;',
    '    border: 1px solid rgba(255, 255, 255, 0.14);',
    '    border-radius: 6px;',
    '    background: rgba(255, 255, 255, 0.06);',
    '    color: #e8e8ee;',
    '    font: inherit;',
    '    cursor: pointer;',
    '  }',
    '  .bvr-row button:hover { background: rgba(255, 255, 255, 0.14); }',
    '  .bvr-row button.bvr-on { background: #00aeec; border-color: #00aeec; color: #fff; }',
    '  .bvr-row button:focus-visible { outline: 2px solid #00aeec; outline-offset: 1px; }',
    '  .bvr-label { display: flex; justify-content: space-between; margin: 2px 0 4px; color: #b9b9c4; }',
    '  .bvr-label span:last-child { color: #e8e8ee; font-variant-numeric: tabular-nums; }',
    '  input[type="range"] { width: 100%; margin: 0 0 8px; accent-color: #00aeec; }',
    '</style>',
    '<button id="bvr-btn" class="bvr-btn" type="button" aria-label="旋转播放器画面" aria-pressed="false" title="单击：旋转 / 还原；右键：设置">',
    '  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">',
    '    <path d="M3 12a9 9 0 1 0 3.1-6.8"></path>',
    '    <polyline points="3 4 3 9 8 9"></polyline>',
    '  </svg>',
    '</button>',
    '<div id="bvr-panel" class="bvr-panel" role="dialog" aria-label="播放器旋转 / 镜像设置" aria-hidden="true" hidden>',
    '  <div class="bvr-head"><span>播放器旋转 / 镜像</span><button id="bvr-close" class="bvr-x" type="button" aria-label="关闭面板">×</button></div>',
    '  <div id="bvr-angle" class="bvr-angle">0°</div>',
    '  <div class="bvr-row">',
    '    <button id="bvr-ccw" type="button" title="逆时针旋转 90°">↺ -90°</button>',
    '    <button id="bvr-cw" type="button" title="顺时针旋转 90°">↻ +90°</button>',
    '  </div>',
    '  <div class="bvr-label"><span>微调</span><span id="bvr-fine-val">0°</span></div>',
    '  <input id="bvr-fine" type="range" min="-15" max="15" step="0.5" value="0" aria-label="角度微调">',
    '  <div class="bvr-row">',
    '    <button id="bvr-fine-minus" type="button">-1°</button>',
    '    <button id="bvr-fine-zero" type="button">归零</button>',
    '    <button id="bvr-fine-plus" type="button">+1°</button>',
    '  </div>',
    '  <div class="bvr-label"><span>镜像</span></div>',
    '  <div class="bvr-row">',
    '    <button id="bvr-flip-x" type="button" aria-pressed="false">水平镜像</button>',
    '    <button id="bvr-flip-y" type="button" aria-pressed="false">垂直镜像</button>',
    '  </div>',
    '  <div class="bvr-label"><span>缩放</span><span id="bvr-zoom-val">100%</span></div>',
    '  <div class="bvr-row">',
    '    <button id="bvr-zoom-out" type="button" aria-label="缩小">−</button>',
    '    <button id="bvr-zoom-in" type="button" aria-label="放大">+</button>',
    '  </div>',
    '  <div class="bvr-label"><span>适配</span></div>',
    '  <div class="bvr-row">',
    '    <button id="bvr-fit-cover" type="button">铺满</button>',
    '    <button id="bvr-fit-contain" type="button">完整显示</button>',
    '  </div>',
    '  <div class="bvr-label"><span>渲染</span></div>',
    '  <div class="bvr-row">',
    '    <button id="bvr-render-css" type="button" title="使用 CSS transform 旋转（默认，兼容性最好）">CSS</button>',
    '    <button id="bvr-render-webgl" type="button" title="WebGL 可能降低旋转时的 GPU 占用，但不支持 HDR/DRM，可能黑屏或颜色异常，异常时自动回退">WebGL（实验）</button>',
    '  </div>',
    '  <div class="bvr-row">',
    '    <button id="bvr-reset" type="button">重置</button>',
    '    <button id="bvr-close2" type="button">关闭</button>',
    '  </div>',
    '</div>'
  ].join('\n');

  document.body.appendChild(host);

  const btn = shadow.getElementById('bvr-btn');
  const panel = shadow.getElementById('bvr-panel');
  const angleValue = shadow.getElementById('bvr-angle');
  const fineSlider = shadow.getElementById('bvr-fine');
  const fineValue = shadow.getElementById('bvr-fine-val');
  const zoomValue = shadow.getElementById('bvr-zoom-val');
  const fitCover = shadow.getElementById('bvr-fit-cover');
  const fitContain = shadow.getElementById('bvr-fit-contain');
  const flipXBtn = shadow.getElementById('bvr-flip-x');
  const flipYBtn = shadow.getElementById('bvr-flip-y');
  const renderCssBtn = shadow.getElementById('bvr-render-css');
  const renderWebglBtn = shadow.getElementById('bvr-render-webgl');

  let panelOpen = false;
  let drag = null;
  let suppressClick = false;

  function applyIconPos() {
    const maxTop = Math.max(EDGE_MARGIN, window.innerHeight - BTN_SIZE - EDGE_MARGIN);
    iconPos.top = clamp(iconPos.top, EDGE_MARGIN, maxTop);
    const left = iconPos.edge === 'left'
      ? EDGE_MARGIN
      : Math.max(EDGE_MARGIN, window.innerWidth - BTN_SIZE - EDGE_MARGIN);
    host.style.left = Math.round(left) + 'px';
    host.style.top = Math.round(iconPos.top) + 'px';
  }

  function setUIVisible(visible) {
    if (!visible) closePanel();
    host.style.display = visible ? '' : 'none';
    if (visible) host.removeAttribute('aria-hidden');
    else host.setAttribute('aria-hidden', 'true');
  }

  function positionPanel() {
    if (panel.hidden) return;
    panel.style.visibility = 'hidden';
    const btnRect = btn.getBoundingClientRect();
    const pw = panel.offsetWidth || 236;
    const ph = panel.offsetHeight || 300;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = iconPos.edge === 'right'
      ? btnRect.left - pw - PANEL_MARGIN
      : btnRect.right + PANEL_MARGIN;
    left = clamp(left, PANEL_MARGIN, Math.max(PANEL_MARGIN, vw - pw - PANEL_MARGIN));
    const top = clamp(btnRect.top, PANEL_MARGIN, Math.max(PANEL_MARGIN, vh - ph - PANEL_MARGIN));

    panel.style.left = Math.round(left) + 'px';
    panel.style.top = Math.round(top) + 'px';
    panel.style.visibility = '';
  }

  function openPanel() {
    panelOpen = true;
    panel.hidden = false;
    panel.setAttribute('aria-hidden', 'false');
    syncUI();
    positionPanel();
  }

  function closePanel() {
    if (!panelOpen) {
      panel.hidden = true;
      return;
    }
    panelOpen = false;
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
  }

  function syncUI() {
    const angle = currentAngle();
    angleValue.textContent = displayAngle(angle) + '°';
    fineSlider.value = String(state.fine);
    fineValue.textContent = (state.fine > 0 ? '+' : '') + displayAngle(state.fine) + '°';
    zoomValue.textContent = Math.round(state.zoom * 100) + '%';
    fitCover.classList.toggle('bvr-on', state.fit === 'cover');
    fitContain.classList.toggle('bvr-on', state.fit === 'contain');
    flipXBtn.classList.toggle('bvr-on', state.flipX);
    flipYBtn.classList.toggle('bvr-on', state.flipY);
    flipXBtn.setAttribute('aria-pressed', state.flipX ? 'true' : 'false');
    flipYBtn.setAttribute('aria-pressed', state.flipY ? 'true' : 'false');
    const webglMode = prefs.renderMode === 'webgl';
    renderCssBtn.classList.toggle('bvr-on', !webglMode);
    renderWebglBtn.classList.toggle('bvr-on', webglMode);
    renderCssBtn.setAttribute('aria-pressed', !webglMode ? 'true' : 'false');
    renderWebglBtn.setAttribute('aria-pressed', webglMode ? 'true' : 'false');
    btn.classList.toggle('bvr-active', isTransformActive());
    btn.setAttribute('aria-pressed', isTransformActive() ? 'true' : 'false');
  }

  /* 快捷切换只看旋转与缩放，镜像状态保持不变 */
  function toggleQuick() {
    if (!activePlayer) return;
    const turned = Math.abs(currentAngle()) > 0.001 || Math.abs(state.zoom - 1) > 0.0001;
    if (turned) {
      state.quarterTurns = 0;
      state.fine = 0;
      state.zoom = 1;
    } else {
      state.quarterTurns = Math.round(prefs.quickAngle / 90);
      state.fine = 0;
      state.zoom = 1;
    }
    scheduleUpdate(true);
    persistSession();
    syncUI();
  }

  function stepQuarter(direction) {
    state.quarterTurns += direction;
    scheduleUpdate(true);
    persistSession();
    syncUI();
  }

  function setFine(value) {
    state.fine = clamp(round1(value), -FINE_LIMIT, FINE_LIMIT);
    if (state.fine === 0) state.fine = 0;
    scheduleUpdate(true);
    persistSession();
    syncUI();
  }

  function stepZoom(direction) {
    const next = Math.round((state.zoom + direction * prefs.zoomStep) * 10) / 10;
    state.zoom = clamp(next, ZOOM_MIN, ZOOM_MAX);
    scheduleUpdate(true);
    persistSession();
    syncUI();
  }

  function setFit(mode) {
    state.fit = mode === 'contain' ? 'contain' : 'cover';
    prefs.fit = state.fit;
    store.set(KEY_PREFS, prefs);
    scheduleUpdate(true);
    syncUI();
  }

  function setRenderMode(mode) {
    const next = mode === 'webgl' ? 'webgl' : 'css';
    if (prefs.renderMode === next) {
      /* 再次点击当前模式：清除本视频的回退标记，允许手动重试 */
      if (next === 'webgl' && (webglBlocked || renderer.fallbackReason)) {
        webglBlocked = false;
        webglFallbackReason = '';
        renderer.fallbackReason = '';
        metrics = null;
        scheduleUpdate(false);
        syncUI();
      }
      return;
    }
    prefs.renderMode = next;
    store.set(KEY_PREFS, prefs);

    /* 立即停止旧路径并恢复 video，再交给下一次更新启动新路径 */
    webglBlocked = false;
    webglFallbackReason = '';
    renderer.fallbackReason = '';
    if (renderer.active) renderer.destroy();
    if (activePlayer) clearVideoStyles(activePlayer.video);
    metrics = null;

    try {
      console.info(
        '[bilibili-video-rotate] 渲染模式：' + (next === 'webgl' ? 'WebGL（实验）' : 'CSS')
      );
    } catch (err) {}
    scheduleUpdate(false);
    syncUI();
  }

  function toggleFlip(axis) {
    if (axis === 'x') state.flipX = !state.flipX;
    else state.flipY = !state.flipY;
    /* 镜像必须瞬时生效：1 → -1 的过渡会让画面经过 0 宽度而闪烁 */
    scheduleUpdate(false);
    persistSession();
    syncUI();
  }

  function resetTransform() {
    const hadFlip = state.flipX || state.flipY;
    resetTransformState('explicit');
    scheduleUpdate(!hadFlip);
    syncUI();
  }

  function endDrag(event) {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    const wasMoved = drag.moved;
    try {
      btn.releasePointerCapture(drag.id);
    } catch (err) {
      /* 指针已释放 */
    }
    drag = null;
    btn.classList.remove('bvr-dragging');
    if (!wasMoved) return;

    suppressClick = true;
    window.setTimeout(function () {
      suppressClick = false;
    }, 0);

    const rect = btn.getBoundingClientRect();
    iconPos = {
      edge: rect.left + rect.width / 2 < window.innerWidth / 2 ? 'left' : 'right',
      top: rect.top
    };
    applyIconPos();
    store.set(KEY_ICON, iconPos);
  }

  btn.addEventListener('pointerdown', function (event) {
    if (event.button !== 0) return;
    const rect = btn.getBoundingClientRect();
    drag = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      moved: false
    };
    try {
      btn.setPointerCapture(event.pointerId);
    } catch (err) {
      /* 部分环境不支持指针捕获 */
    }
    event.preventDefault();
  });

  btn.addEventListener('pointermove', function (event) {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) {
      drag.moved = true;
      btn.classList.add('bvr-dragging');
      closePanel();
    }
    if (!drag.moved) return;

    const maxLeft = Math.max(EDGE_MARGIN, window.innerWidth - BTN_SIZE - EDGE_MARGIN);
    const maxTop = Math.max(EDGE_MARGIN, window.innerHeight - BTN_SIZE - EDGE_MARGIN);
    host.style.left = Math.round(clamp(drag.left + dx, EDGE_MARGIN, maxLeft)) + 'px';
    host.style.top = Math.round(clamp(drag.top + dy, EDGE_MARGIN, maxTop)) + 'px';
  });

  btn.addEventListener('pointerup', endDrag);
  btn.addEventListener('pointercancel', endDrag);

  btn.addEventListener('click', function () {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    toggleQuick();
  });

  btn.addEventListener('contextmenu', function (event) {
    event.preventDefault();
    event.stopPropagation();
    if (panelOpen) closePanel();
    else openPanel();
  });

  shadow.getElementById('bvr-ccw').addEventListener('click', function () {
    stepQuarter(-1);
  });
  shadow.getElementById('bvr-cw').addEventListener('click', function () {
    stepQuarter(1);
  });
  shadow.getElementById('bvr-fine-minus').addEventListener('click', function () {
    setFine(state.fine - 1);
  });
  shadow.getElementById('bvr-fine-plus').addEventListener('click', function () {
    setFine(state.fine + 1);
  });
  shadow.getElementById('bvr-fine-zero').addEventListener('click', function () {
    setFine(0);
  });
  fineSlider.addEventListener('input', function () {
    setFine(parseFloat(fineSlider.value) || 0);
  });
  shadow.getElementById('bvr-zoom-out').addEventListener('click', function () {
    stepZoom(-1);
  });
  shadow.getElementById('bvr-zoom-in').addEventListener('click', function () {
    stepZoom(1);
  });
  fitCover.addEventListener('click', function () {
    setFit('cover');
  });
  fitContain.addEventListener('click', function () {
    setFit('contain');
  });
  flipXBtn.addEventListener('click', function () {
    toggleFlip('x');
  });
  flipYBtn.addEventListener('click', function () {
    toggleFlip('y');
  });
  renderCssBtn.addEventListener('click', function () {
    setRenderMode('css');
  });
  renderWebglBtn.addEventListener('click', function () {
    setRenderMode('webgl');
  });
  shadow.getElementById('bvr-reset').addEventListener('click', function () {
    resetTransform();
  });
  shadow.getElementById('bvr-close').addEventListener('click', closePanel);
  shadow.getElementById('bvr-close2').addEventListener('click', closePanel);

  document.addEventListener('pointerdown', function (event) {
    if (!panelOpen) return;
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    if (path.indexOf(host) !== -1) return;
    closePanel();
  }, true);

  document.addEventListener('keydown', function (event) {
    if (!panelOpen) return;
    if (event.key === 'Escape' || event.key === 'Esc') {
      event.stopPropagation();
      closePanel();
    }
  }, true);

  /* ---------- 全屏与视口 ---------- */

  function getFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function isViewportFilling(rect) {
    if (!rect) return false;
    return (
      Math.abs(rect.left) <= 2 &&
      Math.abs(rect.top) <= 2 &&
      rect.width >= window.innerWidth * 0.98 &&
      rect.height >= window.innerHeight * 0.9
    );
  }

  function isImmersive() {
    if (getFullscreenElement()) return true;

    const screens = document.querySelectorAll('.bpx-player-container[data-screen]');
    for (let i = 0; i < screens.length; i += 1) {
      const el = screens[i];
      const value = String(el.getAttribute('data-screen') || '').toLowerCase().replace(/\s+/g, '');
      if (value === 'web') {
        /* 部分版本用 web 表示普通模式，需结合样式与几何尺寸确认 */
        let rect = null;
        let position = '';
        try {
          rect = el.getBoundingClientRect();
          position = window.getComputedStyle(el).position;
        } catch (err) {}
        if (isViewportFilling(rect)) return true;
        if (
          position === 'fixed' &&
          rect &&
          rect.left <= 2 &&
          rect.top <= 2 &&
          rect.width >= window.innerWidth * 0.98 &&
          rect.height >= window.innerHeight * 0.6
        ) {
          return true;
        }
        if (
          el.classList.contains('bpx-state-fullscreen') ||
          el.classList.contains('mode-webscreen') ||
          el.classList.contains('mode-fullscreen')
        ) {
          return true;
        }
        continue;
      }
      if (value && WEB_SCREEN_VALUES.indexOf(value) !== -1) return true;
    }

    const roots = [];
    const pushRoot = function (el) {
      if (el && el.nodeType === 1 && roots.indexOf(el) === -1) roots.push(el);
    };
    if (activePlayer) {
      pushRoot(activePlayer.player);
      pushRoot(activePlayer.container);
    }

    for (let j = 0; j < roots.length; j += 1) {
      const list = roots[j].classList;
      if (!list) continue;
      if (
        list.contains('bpx-state-fullscreen') ||
        list.contains('mode-webscreen') ||
        list.contains('mode-fullscreen')
      ) {
        return true;
      }
    }

    for (let k = 0; k < roots.length; k += 1) {
      const root = roots[k];
      if (typeof root.getBoundingClientRect !== 'function') continue;
      let rect = null;
      try {
        rect = root.getBoundingClientRect();
      } catch (err) {}
      if (rect && rect.width > 0 && rect.height > 0 && isViewportFilling(rect)) return true;
    }

    return false;
  }

  function syncChrome() {
    if (isImmersive()) {
      if (drag) {
        try {
          btn.releasePointerCapture(drag.id);
        } catch (err) {}
        drag = null;
        btn.classList.remove('bvr-dragging');
      }
      closePanel();
      host.style.display = 'none';
      host.setAttribute('aria-hidden', 'true');
      return;
    }
    host.style.display = '';
    host.removeAttribute('aria-hidden');
    if (!drag) applyIconPos();
  }

  function placeHost() {
    if (drag) return;
    if (host.isConnected && host.parentNode === document.body) return;
    try {
      document.body.appendChild(host);
    } catch (err) {
      /* 极端情况下放弃挂载 */
    }
  }

  function handleViewportChange() {
    placeHost();
    syncChrome();
    if (panelOpen) positionPanel();
    scheduleUpdate(false);
  }

  /* ---------- 诊断 ---------- */

  function describeNode(el) {
    if (!el || el.nodeType !== 1) return null;
    let text = String(el.tagName || '').toLowerCase();
    if (el.id) text += '#' + el.id;
    if (el.classList && el.classList.length) {
      text += '.' + Array.prototype.slice.call(el.classList).join('.');
    }
    return text;
  }

  function rectSummary(rect) {
    if (!rect) return null;
    return {
      left: round1(rect.left),
      top: round1(rect.top),
      width: round1(rect.width),
      height: round1(rect.height)
    };
  }

  function nodeRect(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return null;
    try {
      return el.getBoundingClientRect();
    } catch (err) {
      return null;
    }
  }

  function navigationType() {
    try {
      if (window.performance && typeof window.performance.getEntriesByType === 'function') {
        const entries = window.performance.getEntriesByType('navigation');
        if (entries && entries.length && entries[0] && entries[0].type) return entries[0].type;
      }
      if (window.performance && window.performance.navigation) {
        return ['navigate', 'reload', 'back_forward'][window.performance.navigation.type] || '';
      }
    } catch (err) {
      /* 部分沙箱不提供 Navigation Timing */
    }
    return '';
  }

  function logDiagnostics() {
    const video = activePlayer && activePlayer.video;
    let dataScreen = '';
    document.querySelectorAll('.bpx-player-container[data-screen]').forEach(function (el) {
      const value = String(el.getAttribute('data-screen') || '');
      if (!value) return;
      dataScreen += (dataScreen ? ', ' : '') + value;
    });

    if (!video || !video.isConnected) {
      console.log('[bilibili-video-rotate] 旋转/镜像诊断：未找到播放器', {
        url: window.location.href,
        trackedUrl: trackedUrl,
        mediaKey: mediaKey(),
        trackedMedia: trackedMedia,
        visibility: document.visibilityState,
        navigationType: navigationType(),
        resetReason: resetReason,
        dataScreen: dataScreen,
        immersive: isImmersive(),
        fullscreenElement: describeNode(getFullscreenElement()),
        player: describeNode(activePlayer && activePlayer.player),
        container: describeNode(activePlayer && activePlayer.container),
        flipX: state.flipX,
        flipY: state.flipY,
        renderMode: prefs.renderMode,
        webglActive: renderer.active,
        webglBlocked: webglBlocked,
        fallbackReason: webglFallbackReason,
        webglCounters: {
          activations: renderer.activations,
          rehosts: renderer.rehosts,
          canvasRemovals: renderer.canvasRemovals,
          reveals: renderer.reveals,
          emptyUploads: renderer.emptyUploads
        },
        appliedClass: false,
        stats: { updates: stats.updates, writes: stats.writes, measures: stats.measures }
      });
      return;
    }

    /* 诊断也要遵守“测量期间不存在动画类”的约定 */
    cancelAnim(video);
    const boxRect = measureVideoBox(video);
    const picture = boxRect ? getPictureBox(video, boxRect) : null;
    const stage = resolveStage(activePlayer, boxRect);
    const angle = currentAngle();
    let objectFit = '';
    try {
      objectFit = window.getComputedStyle(video).objectFit;
    } catch (err) {}

    let appliedAngle = null;
    let appliedScale = null;
    let appliedFlipX = null;
    let appliedFlipY = null;
    let appliedClass = false;
    try {
      appliedAngle = video.style.getPropertyValue('--bvr-angle').trim() || null;
      appliedScale = video.style.getPropertyValue('--bvr-scale').trim() || null;
      appliedFlipX = video.style.getPropertyValue('--bvr-flip-x').trim() || null;
      appliedFlipY = video.style.getPropertyValue('--bvr-flip-y').trim() || null;
      appliedClass = video.classList.contains(CLASS_ACTIVE);
    } catch (err) {
      appliedAngle = null;
      appliedScale = null;
      appliedFlipX = null;
      appliedFlipY = null;
      appliedClass = false;
    }

    const info = {
      url: window.location.href,
      trackedUrl: trackedUrl,
      mediaKey: mediaKey(),
      trackedMedia: trackedMedia,
      visibility: document.visibilityState,
      navigationType: navigationType(),
      resetReason: resetReason,
      dataScreen: dataScreen,
      immersive: isImmersive(),
      fullscreenElement: describeNode(getFullscreenElement()),
      player: describeNode(activePlayer && activePlayer.player),
      playerRect: rectSummary(nodeRect(activePlayer && activePlayer.player)),
      container: describeNode(activePlayer && activePlayer.container),
      containerRect: rectSummary(nodeRect(activePlayer && activePlayer.container)),
      videoSize: video.videoWidth + 'x' + video.videoHeight,
      objectFit: objectFit,
      videoBox: rectSummary(boxRect),
      pictureBox: rectSummary(picture),
      stage: rectSummary(stage),
      stageSource: stage.source,
      angle: round1(angle),
      fit: state.fit,
      zoom: round1(state.zoom),
      flipX: state.flipX,
      flipY: state.flipY,
      scale: picture ? Math.round(computeScale(picture, stage, angle) * 10000) / 10000 : null,
      appliedAngle: appliedAngle,
      appliedScale: appliedScale,
      appliedFlipX: appliedFlipX,
      appliedFlipY: appliedFlipY,
      appliedClass: appliedClass,
      renderMode: prefs.renderMode,
      webglActive: renderer.active,
      webglBlocked: webglBlocked,
      webglSkipReason: webglSkipReasonCurrent,
      fallbackReason: webglFallbackReason || renderer.fallbackReason || '',
      webglCounters: {
        activations: renderer.activations,
        rehosts: renderer.rehosts,
        canvasRemovals: renderer.canvasRemovals,
        reveals: renderer.reveals,
        emptyUploads: renderer.emptyUploads
      },
      webgl: renderer.describe(),
      stats: { updates: stats.updates, writes: stats.writes, measures: stats.measures },
      metricsCached: !!metrics,
      metrics: metrics
        ? {
            picture: rectSummary(metrics.picture),
            stage: rectSummary(metrics.stage),
            stageSource: metrics.stage.source,
            signature: metrics.signature || null
          }
        : null,
      animClass: video.classList.contains(CLASS_ANIM),
      animPending: animTimer !== 0
    };

    console.log('[bilibili-video-rotate] 旋转/镜像诊断', info);
  }

  /* ---------- 尺寸观察 ---------- */

  let sizeObserver = null;
  let observedVideo = null;
  let observedContainer = null;
  const sizeKeys = new WeakMap();

  function sizeChanged(el, rect) {
    const width = Math.round((rect && rect.width ? rect.width : 0) * 10) / 10;
    const height = Math.round((rect && rect.height ? rect.height : 0) * 10) / 10;
    const previous = sizeKeys.get(el);
    if (
      previous &&
      Math.abs(previous.width - width) < 0.5 &&
      Math.abs(previous.height - height) < 0.5
    ) {
      return false;
    }
    sizeKeys.set(el, { width: width, height: height });
    return true;
  }

  function observeSizes(player) {
    if (typeof window.ResizeObserver !== 'function') return;
    if (!sizeObserver) {
      sizeObserver = new window.ResizeObserver(function (entries) {
        let relevant = false;
        for (let i = 0; i < entries.length; i += 1) {
          const entry = entries[i];
          if (sizeChanged(entry.target, entry.contentRect)) relevant = true;
        }
        if (relevant) scheduleUpdate(false);
      });
    }
    if (observedVideo !== player.video) {
      if (observedVideo) {
        try { sizeObserver.unobserve(observedVideo); } catch (err) {}
      }
      observedVideo = player.video;
      try { sizeObserver.observe(observedVideo); } catch (err) {}
    }
    if (observedContainer !== player.container) {
      if (observedContainer) {
        try { sizeObserver.unobserve(observedContainer); } catch (err) {}
      }
      observedContainer = player.container;
      try { sizeObserver.observe(observedContainer); } catch (err) {}
    }
  }

  function releaseSizes() {
    if (!sizeObserver) return;
    try { sizeObserver.disconnect(); } catch (err) {}
    observedVideo = null;
    observedContainer = null;
  }

  /* ---------- 播放器状态观察 ---------- */

  let stateObserver = null;
  let stateTimer = 0;
  let stateTargets = [];
  const stateKeys = new WeakMap();

  /* 只关心沉浸 / 迷你等模式相关变化，忽略 hover / controls / 脚本自身类带来的变化 */
  function immersiveKey(el) {
    const screen = String(el.getAttribute('data-screen') || '')
      .toLowerCase()
      .replace(/\s+/g, '');
    const list = el.classList || { contains: function () { return false; } };
    return (
      screen +
      '|' +
      (list.contains('bpx-state-fullscreen') ? 1 : 0) +
      (list.contains('mode-webscreen') ? 1 : 0) +
      (list.contains('mode-fullscreen') ? 1 : 0)
    );
  }

  function sameTargets(next) {
    if (next.length !== stateTargets.length) return false;
    for (let i = 0; i < next.length; i += 1) {
      if (next[i] !== stateTargets[i]) return false;
    }
    return true;
  }

  function releasePlayerState() {
    if (stateObserver) {
      try { stateObserver.disconnect(); } catch (err) {}
    }
    stateTargets = [];
    if (stateTimer) {
      window.clearTimeout(stateTimer);
      stateTimer = 0;
    }
  }

  function observePlayerState() {
    if (typeof window.MutationObserver !== 'function') return;
    if (!stateObserver) {
      stateObserver = new window.MutationObserver(function (records) {
        let relevant = false;
        for (let i = 0; i < records.length; i += 1) {
          const target = records[i].target;
          if (!target || target.nodeType !== 1) continue;
          let key = '';
          try {
            key = immersiveKey(target);
          } catch (err) {
            continue;
          }
          if (stateKeys.get(target) !== key) {
            stateKeys.set(target, key);
            relevant = true;
          }
        }
        if (!relevant || stateTimer) return;
        stateTimer = window.setTimeout(function () {
          stateTimer = 0;
          /* 迷你 / 全屏切换会改变播放器根节点，需要重新解析 activePlayer */
          detect();
        }, 120);
      });
    }

    const targets = [];
    const push = function (el) {
      if (el && el.nodeType === 1 && targets.indexOf(el) === -1) targets.push(el);
    };
    if (activePlayer) {
      push(activePlayer.player);
      push(activePlayer.container);
      const video = activePlayer.video;
      if (video && typeof video.closest === 'function') {
        push(video.closest('.bpx-player-container'));
        push(video.closest('#bilibili-player'));
      }
    }
    document.querySelectorAll('.bpx-player-container[data-screen]').forEach(push);

    if (sameTargets(targets)) return;
    try {
      stateObserver.disconnect();
    } catch (err) {}
    stateTargets = targets;

    targets.forEach(function (el) {
      try {
        stateKeys.set(el, immersiveKey(el));
        stateObserver.observe(el, {
          attributes: true,
          attributeFilter: ['class', 'data-screen']
        });
      } catch (err) {}
    });
  }

  /* ---------- 生命周期 ---------- */

  function debugLog(data) {
    if (!debugEnabled) return;
    try {
      console.log('[bilibili-video-rotate] detect', data);
    } catch (err) {
      /* 控制台不可用时忽略 */
    }
  }

  function detect() {
    const url = window.location.href;
    const nextMedia = mediaKey();
    const mediaChanged = trackedMedia !== null && trackedMedia !== nextMedia;
    /* 只有真正换视频时才放弃旧 video 的稳定性偏好，URL 跟踪参数变化不影响 */
    const found = findActivePlayer(mediaChanged ? null : trackedVideo);

    if (mediaChanged) {
      if (renderer.active) renderer.destroy();
      webglBlocked = false;
      webglFallbackReason = '';
      renderer.fallbackReason = '';
      resetTransformState('media-change');
      syncUI();
    }
    if (trackedMedia === null) {
      trackedMedia = nextMedia;
      /* 首次加载且没有可恢复的会话时，覆盖同标签页遗留的旧键 */
      clearSession();
    } else if (mediaChanged) {
      trackedMedia = nextMedia;
    }

    if (!found) {
      cancelAnim();
      metrics = null;
      if (renderer.active) renderer.destroy();
      if (activePlayer) clearVideoStyles(activePlayer.video);
      activePlayer = null;
      /* 旧节点仍连接时保留身份锚点，避免下一次 detect 误判为节点被替换 */
      if (trackedVideo && !trackedVideo.isConnected) trackedVideo = null;
      trackedUrl = url;
      setUIVisible(false);
      releaseSizes();
      releasePlayerState();
      debugLog({
        url: url,
        mediaKey: nextMedia,
        mediaChanged: mediaChanged,
        videoChanged: false,
        found: false,
        resetReason: resetReason
      });
      return;
    }

    const videoChanged = trackedVideo !== found.video;
    if (videoChanged) {
      metrics = null;
      cancelAnim();
      if (renderer.active) renderer.destroy();
      /* 新 video 元素允许重新尝试实验模式；同一视频失败后不再重试 */
      webglBlocked = false;
      webglFallbackReason = '';
      renderer.fallbackReason = '';
      if (trackedVideo) clearVideoStyles(trackedVideo);
    }

    trackedVideo = found.video;
    trackedUrl = url;
    activePlayer = found;
    observeSizes(found);
    observePlayerState();
    observeShadowRoot(found.video);
    placeHost();
    syncChrome();
    scheduleUpdate(false);

    debugLog({
      url: url,
      mediaKey: nextMedia,
      mediaChanged: mediaChanged,
      videoChanged: videoChanged,
      found: true,
      trackedVideoConnected: !!(trackedVideo && trackedVideo.isConnected),
      video: describeNode(found.video),
      resetReason: resetReason
    });
  }

  let mutationObserver = null;
  let mutationTimer = 0;

  const STRUCTURE_SELECTOR =
    'video, bwp-video, #bilibili-player, .bpx-player-container, .bpx-player-video-area, .bpx-player-video-wrap';

  function isStructuralNode(node) {
    if (!node || node.nodeType !== 1) return false;
    try {
      if (typeof node.matches === 'function' && node.matches(STRUCTURE_SELECTOR)) return true;
      if (typeof node.querySelector === 'function' && node.querySelector(STRUCTURE_SELECTOR)) {
        return true;
      }
    } catch (err) {
      /* 选择器异常时按不相关处理 */
    }
    return false;
  }

  function hasStructureChange(records) {
    for (let i = 0; i < records.length; i += 1) {
      const record = records[i];
      const added = record.addedNodes;
      const removed = record.removedNodes;
      if (added) {
        for (let j = 0; j < added.length; j += 1) {
          if (isStructuralNode(added[j])) return true;
        }
      }
      if (removed) {
        for (let k = 0; k < removed.length; k += 1) {
          if (isStructuralNode(removed[k])) return true;
        }
      }
    }
    return false;
  }

  /* canvas 被播放器重渲染移除时立即重挂，不等 250ms 节流，避免露出黑底 */
  function repairCanvas() {
    const canvas = renderer.canvas;
    if (!renderer.active || !canvas || canvas.isConnected) return false;
    renderer.canvasRemovals += 1;

    const player = activePlayer;
    if (!player || !player.video || !player.video.isConnected) {
      renderer.deactivate();
      scheduleUpdate(false);
      return false;
    }

    renderer.ensureHost(player);
    if (!renderer.canvas || !renderer.canvas.isConnected) {
      /* 重挂失败就恢复 video，交给下一次更新重新激活 */
      renderer.deactivate();
      scheduleUpdate(false);
      return false;
    }

    renderer.reposition();
    renderer.resize();
    renderer.renderFrame();
    return true;
  }

  function startMutationObserver() {
    if (mutationObserver || !document.body) return;
    mutationObserver = new MutationObserver(function (records) {
      /* canvas 被移除时优先修复；其余结构变化仍走 250ms 节流 */
      repairCanvas();
      /* video 已断开时立即视为相关；弹幕/浮层等无关键点直接忽略 */
      const stale = !!(activePlayer && activePlayer.video && !activePlayer.video.isConnected);
      if (!stale && !hasStructureChange(records)) return;
      if (mutationTimer) return;
      mutationTimer = window.setTimeout(function () {
        mutationTimer = 0;
        detect();
      }, 250);
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });
  }

  /* document.body 观察不到 shadow root 内的播放器重建，单独补一个观察器 */
  let shadowObserver = null;
  let shadowRoot = null;
  let shadowTimer = 0;

  function observeShadowRoot(video) {
    if (typeof window.MutationObserver !== 'function') return;
    let root = null;
    try {
      root = video && typeof video.getRootNode === 'function' ? video.getRootNode() : null;
    } catch (err) {
      root = null;
    }

    if (!root || root.nodeType !== 11 || !root.host) {
      if (shadowRoot) {
        if (shadowObserver) {
          try { shadowObserver.disconnect(); } catch (err) {}
        }
        shadowRoot = null;
      }
      return;
    }
    if (root === shadowRoot) return;

    if (!shadowObserver) {
      shadowObserver = new window.MutationObserver(function (records) {
        /* shadow root 内的 canvas 移除同样要立即重挂 */
        repairCanvas();
        const stale = !!(activePlayer && activePlayer.video && !activePlayer.video.isConnected);
        if (!stale && !hasStructureChange(records)) return;
        if (shadowTimer) return;
        shadowTimer = window.setTimeout(function () {
          shadowTimer = 0;
          detect();
        }, 250);
      });
    }

    try { shadowObserver.disconnect(); } catch (err) {}
    try {
      shadowObserver.observe(root, { childList: true, subtree: true });
      shadowRoot = root;
    } catch (err) {
      shadowRoot = null;
    }
  }

  let restoreTimer = 0;

  function scheduleRestore() {
    /* 已有 detect 在排队时直接复用，避免同一时刻跑两次 */
    if (restoreTimer || stateTimer || mutationTimer) return;
    restoreTimer = window.setTimeout(function () {
      restoreTimer = 0;
      detect();
    }, 150);
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      persistSession();
      if (renderer.active) renderer.onHidden();
      return;
    }
    if (renderer.active) renderer.onVisible();
    scheduleRestore();
  }

  function handlePageHide() {
    persistSession();
  }

  function handlePageShow(event) {
    if (!event || event.persisted) scheduleRestore();
  }

  function handleResume() {
    scheduleRestore();
  }

  function hookHistory() {
    const notify = function () {
      window.setTimeout(detect, 0);
    };
    try {
      ['pushState', 'replaceState'].forEach(function (name) {
        const original = window.history[name];
        if (typeof original !== 'function') return;
        window.history[name] = function () {
          const result = original.apply(this, arguments);
          notify();
          return result;
        };
      });
    } catch (err) {
      /* 沙箱禁止改写 history 时依赖 popstate 与 DOM 观察 */
    }
    window.addEventListener('popstate', notify);
  }

  /* ---------- 初始化 ---------- */

  /* 同一标签页重载（含标签页被丢弃）后恢复变换；只在媒体身份一致时生效 */
  const restoredMedia = restoreSession();
  if (restoredMedia) trackedMedia = restoredMedia;

  injectStyle();
  applyIconPos();
  syncUI();
  startMutationObserver();
  hookHistory();
  detect();

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('pagehide', handlePageHide);
  window.addEventListener('pageshow', handlePageShow);
  window.addEventListener('resume', handleResume);
  document.addEventListener('fullscreenchange', handleViewportChange);
  document.addEventListener('webkitfullscreenchange', handleViewportChange);
  document.addEventListener('loadedmetadata', function () {
    /* 播放器重建后 activePlayer 可能已清空，元数据就绪时重新识别一次 */
    if (!activePlayer) detect();
    else scheduleUpdate(false);
  }, true);
  document.addEventListener('resize', function () {
    scheduleUpdate(false);
  }, true);
  window.addEventListener('resize', handleViewportChange);

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('旋转 / 还原', function () {
      if (!activePlayer) detect();
      toggleQuick();
    });
    GM_registerMenuCommand('水平镜像 / 还原', function () {
      if (!activePlayer) detect();
      toggleFlip('x');
    });
    GM_registerMenuCommand('垂直镜像 / 还原', function () {
      if (!activePlayer) detect();
      toggleFlip('y');
    });
    GM_registerMenuCommand('切换 CSS / WebGL 渲染', function () {
      if (!activePlayer) detect();
      setRenderMode(prefs.renderMode === 'webgl' ? 'css' : 'webgl');
    });
    GM_registerMenuCommand('重置悬浮按钮位置', function () {
      iconPos = { edge: 'right', top: defaultIconTop() };
      applyIconPos();
      store.set(KEY_ICON, iconPos);
    });
    GM_registerMenuCommand('输出旋转诊断信息', function () {
      if (!activePlayer) detect();
      logDiagnostics();
    });
  }
})();
