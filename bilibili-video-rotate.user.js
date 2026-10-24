// ==UserScript==
// @name         Bilibili 播放器旋转 / 缩放 / 镜像
// @namespace    https://github.com/shengurun/bilibili-video-rotate
// @version      1.3.0
// @description  在 B 站播放器上旋转 90°、水平/垂直镜像并按真实画面自动适配（默认完整显示，网页全屏时铺满整个浏览器窗口），只变换 <video>，不旋转弹幕/字幕/控制条；同一视频内切换标签页或播放器重建后保留变换。单击悬浮按钮快速切换旋转，右键打开控制面板。
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
 *   - 右键悬浮按钮：打开控制面板（90° 步进 / ±15° 微调 / 水平与垂直镜像 / 缩放 / 铺满或完整显示 / 重置）。
 *   - 拖动悬浮按钮：吸附到屏幕左/右边缘，位置会保存。
 *   - 脚本菜单「旋转 / 还原」：不依赖悬浮按钮的备用开关（全屏时也可用）。
 *   - 脚本菜单「水平镜像 / 还原」「垂直镜像 / 还原」：全屏隐藏悬浮 UI 时切换镜像。
 *   - 脚本菜单「重置悬浮按钮位置」：把按钮放回右侧居中。
 *   - 脚本菜单「输出旋转诊断信息」：在控制台打印当前画面盒/基准区域/镜像等实测数值。
 *
 * 行为说明
 *   - 只变换 <video>，弹幕、字幕、控制条保持正向不动（已知取舍）。
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

  const DEFAULT_PREFS = { quickAngle: -90, fit: 'contain', zoomStep: ZOOM_STEP };
  const storedPrefs = storedOrMigrate(KEY_PREFS, LEGACY_KEY_PREFS);
  const prefs = Object.assign(
    {},
    DEFAULT_PREFS,
    storedPrefs && typeof storedPrefs === 'object' ? storedPrefs : {}
  );
  prefs.quickAngle = -90;
  /* 只有用户显式保存的 cover 才保留，其余（含旧安装）一律完整显示 */
  if (prefs.fit !== 'cover') prefs.fit = 'contain';

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
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (parseFloat(cs.opacity) === 0) return false;
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
    try {
      objectFit = String(window.getComputedStyle(video).objectFit || 'contain').toLowerCase();
    } catch (err) {
      objectFit = 'contain';
    }
    return {
      stageW: stage ? stage.width : 0,
      stageH: stage ? stage.height : 0,
      videoW: size.width,
      videoH: size.height,
      intrinsicW: video.videoWidth || 0,
      intrinsicH: video.videoHeight || 0,
      objectFit: objectFit,
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
      return;
    }

    const video = current.video;

    if (!isTransformActive()) {
      cancelAnim(video);
      clearVideoStyles(video);
      metrics = null;
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

  function startMutationObserver() {
    if (mutationObserver || !document.body) return;
    mutationObserver = new MutationObserver(function (records) {
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
      return;
    }
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
