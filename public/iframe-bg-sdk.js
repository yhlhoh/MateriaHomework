/*!
 * MateriaBackground iframe SDK v1.0.0
 * ------------------------------------------------------------------
 * 用途：让「作业看板」的 iframe 背景页与宿主页面（作业看板）通信。
 *
 * 使用方式（在 iframe 背景页里引入）：
 *   <script src="https://<看板域名>/iframe-bg-sdk.js"></script>
 *   <script>
 *     // 1) 让看板按指定颜色重新取色（重建 Material You 主题）
 *     MateriaBackground.repick('#6750A4');
 *
 *     // 2) 不传颜色：让看板用它自己的背景图 / 缓存主色重新取色
 *     MateriaBackground.repick();
 *
 *     // 3) 把图片直接交给宿主取色（宿主读像素、算主题色并重建主题）
 *     await MateriaBackground.repickFromImage('./wallpaper.jpg');
 *     //    也可以传 <img> 元素：await MateriaBackground.repickFromImage(imgEl);
 *
 *     // 3b) 也可以只在 iframe 内本地取色，再自己决定要不要上报
 *     const color = await MateriaBackground.pickColorFromImage('./wallpaper.jpg');
 *     MateriaBackground.repick(color);
 *
 *     // 4) 监听看板回传的当前主题色
 *     MateriaBackground.onTheme(({ color }) => { document.body.style.background = color; });
 *
 *     // 5) 页面就绪后通知看板（看板会立即回发当前主题）
 *     MateriaBackground.ready();
 *   </script>
 *
 * 协议：window.postMessage，channel = 'materia-homework-iframe-bg'
 *   子页 -> 宿主：color-repick / color-set / color-repick-image / ready
 *   宿主 -> 子页：theme  { color, seed }
 *                 color-pick-result  { requestId, ok, color?, error? }
 * 该文件为无构建依赖的普通脚本，可直接被任意静态页面引用。
 */
(function (global) {
  'use strict';

  var CHANNEL = 'materia-homework-iframe-bg';
  var HOST_SOURCE = 'materia-homework-host';
  var IFRAME_SOURCE = 'materia-homework-iframe';
  var VERSION = '1.0.0';
  var HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
  var RGB_RE = /^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})/i;

  var themeListeners = [];
  var lastTheme = null;
  // 等待宿主回执的图片取色请求：requestId -> { resolve, reject, timer }
  var pendingPicks = new Map();
  var pickSeq = 0;

  function inIframe() {
    try {
      return global.self !== global.top;
    } catch (err) {
      // 跨域访问 top 抛错时说明确实在 iframe 中
      return true;
    }
  }

  function post(type, payload) {
    if (!inIframe()) {
      console.warn('[MateriaBackground] 当前页面不在 iframe 中，消息未发送。');
      return false;
    }
    var message = {
      channel: CHANNEL,
      source: IFRAME_SOURCE,
      type: type,
      version: VERSION,
    };
    if (payload) {
      for (var key in payload) {
        if (Object.prototype.hasOwnProperty.call(payload, key)) message[key] = payload[key];
      }
    }
    try {
      global.parent.postMessage(message, '*');
      return true;
    } catch (err) {
      console.warn('[MateriaBackground] postMessage 发送失败：', err);
      return false;
    }
  }

  function toHex(value) {
    return '#' + value.map(function (n) {
      var v = Math.max(0, Math.min(255, Math.round(Number(n) || 0)));
      return (v < 16 ? '0' : '') + v.toString(16);
    }).join('');
  }

  /** 把 '#abc' / '#aabbcc' / 'rgb(1,2,3)' 统一成 '#rrggbb'，无法解析时返回 '' */
  function normalizeColor(color) {
    if (typeof color !== 'string') return '';
    var value = color.trim();
    if (HEX_RE.test(value)) {
      if (value.length === 4) {
        return ('#' + value[1] + value[1] + value[2] + value[2] + value[3] + value[3]).toLowerCase();
      }
      return value.slice(0, 7).toLowerCase();
    }
    var match = value.match(RGB_RE);
    if (match) {
      return toHex([match[1], match[2], match[3]]);
    }
    return '';
  }

  global.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || typeof data !== 'object' || data.channel !== CHANNEL) return;
    if (data.source !== HOST_SOURCE) return;

    // 宿主完成「图片取色」后的回执
    if (data.type === 'color-pick-result') {
      var entry = pendingPicks.get(data.requestId);
      if (!entry) return;
      pendingPicks.delete(data.requestId);
      clearTimeout(entry.timer);
      if (data.ok && data.color) {
        entry.resolve({ color: normalizeColor(data.color) || data.color });
      } else {
        entry.reject(new Error(data.error || '宿主图片取色失败'));
      }
      return;
    }

    if (data.type !== 'theme') return;
    lastTheme = {
      color: normalizeColor(data.color) || '',
      seed: normalizeColor(data.seed || data.color) || '',
    };
    themeListeners.slice().forEach(function (listener) {
      try {
        listener(lastTheme);
      } catch (err) {
        console.error('[MateriaBackground] onTheme 回调执行出错：', err);
      }
    });
  });

  /** 把 URL / <img> 统一成宿主能接收的图片地址 */
  function resolveImageSource(source) {
    if (typeof source === 'string') return source.trim();
    if (source && typeof source === 'object') {
      var src = source.currentSrc || source.src || '';
      if (typeof src === 'string' && src) return src;
    }
    return '';
  }

  /** 计算图片平均色（图片必须允许 canvas 读取，跨域图片需带 CORS 头） */
  function pickColorFromImage(source, options) {
    var opts = options || {};
    var size = Math.max(1, Math.min(256, opts.size || 32));
    var skipTransparent = opts.skipTransparent !== false;

    return new Promise(function (resolve, reject) {
      var img;
      if (typeof source === 'string') {
        img = new global.Image();
        img.crossOrigin = 'anonymous';
        img.src = source;
      } else {
        img = source;
      }
      if (!img) {
        reject(new Error('pickColorFromImage 需要一个图片 URL 或 <img> 元素'));
        return;
      }

      var run = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          var ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, size, size);
          var data = ctx.getImageData(0, 0, size, size).data;
          var r = 0;
          var g = 0;
          var b = 0;
          var count = 0;
          for (var i = 0; i < data.length; i += 4) {
            if (skipTransparent && data[i + 3] < 16) continue;
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            count += 1;
          }
          if (count === 0) {
            reject(new Error('图片中没有可用的像素'));
            return;
          }
          resolve(toHex([r / count, g / count, b / count]));
        } catch (err) {
          reject(err);
        }
      };

      if (img.complete && img.naturalWidth) {
        run();
        return;
      }
      img.addEventListener('load', run, { once: true });
      img.addEventListener('error', function () {
        reject(new Error('图片加载失败'));
      }, { once: true });
    });
  }

  var MateriaBackground = {
    version: VERSION,
    channel: CHANNEL,

    /**
     * 让宿主重新取色并重建 Material You 主题。
     * @param {string} [color] 目标颜色；省略时宿主会用自身背景图 / 缓存主色重新取色。
     */
    repick: function (color) {
      if (color == null || color === '') return post('color-repick', {});
      var normalized = normalizeColor(color);
      if (!normalized) {
        console.warn('[MateriaBackground] repick 需要一个合法的颜色值：', color);
        return false;
      }
      return post('color-repick', { color: normalized });
    },

    /** repick 的语义化别名 */
    requestColorRepick: function (color) {
      return MateriaBackground.repick(color);
    },

    /** 上报当前页面主色，宿主会立即用它重建主题 */
    setColor: function (color) {
      var normalized = normalizeColor(color);
      if (!normalized) {
        console.warn('[MateriaBackground] setColor 需要一个合法的颜色值：', color);
        return false;
      }
      return post('color-set', { color: normalized });
    },

    /** 通知宿主本页已就绪（宿主会回发当前主题） */
    ready: function () {
      return post('ready');
    },

    /**
     * 监听宿主主题变化。
     * @returns {function} 取消监听
     */
    onTheme: function (callback) {
      if (typeof callback !== 'function') return function () {};
      themeListeners.push(callback);
      if (lastTheme) {
        try {
          callback(lastTheme);
        } catch (err) {
          console.error('[MateriaBackground] onTheme 回调执行出错：', err);
        }
      }
      return function () {
        themeListeners = themeListeners.filter(function (fn) {
          return fn !== callback;
        });
      };
    },

    /** 最近一次收到的宿主主题 */
    getTheme: function () {
      return lastTheme;
    },

    /**
     * 把图片直接交给宿主取色：宿主会读取图片像素、算出主题色并重建 Material You 主题。
     * 跨域图片需要在宿主侧能被 CORS 读取，否则会 reject。
     * @param {string|HTMLImageElement} source 图片地址（http(s) / data:image / blob:）或 <img> 元素
     * @param {{timeout?: number}} [options]
     * @returns {Promise<{color: string}>}
     */
    repickFromImage: function (source, options) {
      var src = resolveImageSource(source);
      if (!src) {
        return Promise.reject(new Error('repickFromImage 需要一个图片地址或 <img> 元素'));
      }
      if (!inIframe()) {
        return Promise.reject(new Error('当前页面不在 iframe 中，无法请求宿主取色'));
      }

      var opts = options || {};
      var timeoutMs = typeof opts.timeout === 'number' && opts.timeout > 0 ? opts.timeout : 20000;
      var requestId = 'pick-' + (++pickSeq) + '-' + Date.now();

      return new Promise(function (resolve, reject) {
        var timer = setTimeout(function () {
          pendingPicks.delete(requestId);
          reject(new Error('等待宿主取色超时'));
        }, timeoutMs);

        pendingPicks.set(requestId, { resolve: resolve, reject: reject, timer: timer });

        if (!post('color-repick-image', { src: src, requestId: requestId })) {
          clearTimeout(timer);
          pendingPicks.delete(requestId);
          reject(new Error('图片取色请求发送失败'));
        }
      });
    },

    normalizeColor: normalizeColor,
    pickColorFromImage: pickColorFromImage,
  };

  global.MateriaBackground = MateriaBackground;
  // 兼容别名，方便书写
  global.MateriaIframeBg = MateriaBackground;
})(window);
