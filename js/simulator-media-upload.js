/**
 * Upload simulator icons / showcase images to Firebase Storage (cms/simulators/*).
 * Raster images are compressed before upload to keep payloads small.
 */
import { uploadCmsFile, rejectDataUrl } from './cms-storage.js';

export { rejectDataUrl };

function safeSimId(simId) {
  return String(simId || 'sim')
    .trim()
    .replace(/[^a-z0-9_-]/gi, '-')
    .slice(0, 80);
}

function extensionFromFile(file, fallback) {
  var name = String((file && file.name) || '').trim();
  var ext = name.indexOf('.') > -1 ? name.split('.').pop() : '';
  ext = String(ext).replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (ext) return ext;
  var type = String((file && file.type) || '').toLowerCase();
  if (type.indexOf('svg') !== -1) return 'svg';
  if (type.indexOf('png') !== -1) return 'png';
  if (type.indexOf('jpeg') !== -1 || type.indexOf('jpg') !== -1) return 'jpg';
  return fallback || 'webp';
}

function isSvgFile(file) {
  var type = String((file && file.type) || '').toLowerCase();
  var name = String((file && file.name) || '').toLowerCase();
  return type.indexOf('svg') !== -1 || name.endsWith('.svg');
}

function isDataUrlSvg(dataUrl) {
  return /^data:image\/svg\+xml/i.test(String(dataUrl || '').trim());
}

export async function compressRasterImage(file, maxW, maxH, quality) {
  if (!file || isSvgFile(file)) return file;

  var bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (err) {
    console.warn('[simulator-media] createImageBitmap failed, uploading original', err);
    return file;
  }

  var w = bitmap.width || 1;
  var h = bitmap.height || 1;
  var scale = Math.min(1, maxW / w, maxH / h);
  var cw = Math.max(1, Math.round(w * scale));
  var ch = Math.max(1, Math.round(h * scale));
  var canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  var ctx = canvas.getContext('2d');
  if (!ctx) {
    if (typeof bitmap.close === 'function') bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, cw, ch);
  if (typeof bitmap.close === 'function') bitmap.close();

  var blob = await new Promise(function (resolve, reject) {
    var timeoutId = setTimeout(function () {
      reject(new Error('انتهى وقت محاولة ضغط الصورة (Timeout)'));
    }, 15000);

    var attemptCompression = function (mimeType, currentQuality) {
      canvas.toBlob(
        function (result) {
          clearTimeout(timeoutId);
          if (result) {
            resolve(result);
          } else if (mimeType === 'image/webp') {
            console.warn('[CMS] WEBP compression failed, trying JPEG...');
            timeoutId = setTimeout(function () {
              reject(new Error('انتهى وقت محاولة ضغط الصورة (Timeout)'));
            }, 15000);
            attemptCompression('image/jpeg', currentQuality);
          } else {
            reject(new Error('فشل ضغط الصورة بجميع التنسيقات'));
          }
        },
        mimeType,
        currentQuality
      );
    };

    attemptCompression('image/webp', quality);
  }).catch(function (err) {
    console.error('[CMS] Compression error, using original file:', err);
    return file;
  });

  if (blob instanceof File) {
    return blob;
  }

  var baseName = String(file.name || 'image').replace(/\.[^.]+$/, '') || 'image';
  var mimeType = blob && blob.type ? blob.type : 'image/webp';
  var ext = mimeType.indexOf('jpeg') !== -1 ? 'jpg' : 'webp';
  return new File([blob], baseName + '.' + ext, { type: mimeType });
}

export async function dataUrlToFile(dataUrl, filename) {
  var src = String(dataUrl || '').trim();
  if (!rejectDataUrl(src)) {
    throw new Error('قيمة الصورة ليست data URL');
  }
  var response = await fetch(src);
  var blob = await response.blob();
  var name = filename || 'image.webp';
  return new File([blob], name, { type: blob.type || 'image/webp' });
}

async function prepareFileForKind(file, kind) {
  if (!file) return null;
  if (kind === 'icon') {
    return compressRasterImage(file, 128, 128, 0.7);
  }
  return compressRasterImage(file, 800, 450, 0.6);
}

export async function uploadSimulatorIcon(simId, file) {
  var prepared = await prepareFileForKind(file, 'icon');
  var ext = extensionFromFile(prepared, 'webp');
  var path =
    'cms/simulators/icons/' + safeSimId(simId) + '/' + Date.now() + '.' + ext;
  return uploadCmsFile(path, prepared);
}

export async function uploadShowcaseImage(simId, file) {
  var prepared = await prepareFileForKind(file, 'showcase');
  var ext = extensionFromFile(prepared, 'webp');
  var path =
    'cms/simulators/showcase/' + safeSimId(simId) + '/' + Date.now() + '.' + ext;
  return uploadCmsFile(path, prepared);
}

function isEphemeralPreviewUrl(value) {
  var str = String(value || '').trim();
  return str.indexOf('blob:') === 0;
}

function isCloudStorageUrl(imageUrl) {
  return (
    typeof imageUrl === 'string' &&
    imageUrl.indexOf('https://firebasestorage.googleapis.com') === 0
  );
}

export async function resolveSimulatorIconUrl(simId, value, pendingFile) {
  var imageUrl = value;
  if (typeof imageUrl === 'string' && isCloudStorageUrl(imageUrl)) {
    console.log('[CMS] Image already uploaded, skipping.');
    return imageUrl;
  }
  if (pendingFile) {
    return uploadSimulatorIcon(simId, pendingFile);
  }
  var str = String(value || '').trim();
  if (!str) return '';
  if (isEphemeralPreviewUrl(str)) {
    throw new Error('أعد رفع أيقونة المحاكي «' + simId + '» قبل النشر.');
  }
  if (!rejectDataUrl(str)) return str;
  if (isDataUrlSvg(str)) {
    var svgFile = await dataUrlToFile(str, safeSimId(simId) + '-icon.svg');
    return uploadSimulatorIcon(simId, svgFile);
  }
  var rasterFile = await dataUrlToFile(str, safeSimId(simId) + '-icon.webp');
  return uploadSimulatorIcon(simId, rasterFile);
}

export async function resolveShowcaseImageUrl(simId, value, pendingFile) {
  var imageUrl = value;
  if (typeof imageUrl === 'string' && isCloudStorageUrl(imageUrl)) {
    console.log('[CMS] Image already uploaded, skipping.');
    return imageUrl;
  }
  if (pendingFile) {
    return uploadShowcaseImage(simId, pendingFile);
  }
  var str = String(value || '').trim();
  if (!str) return '';
  if (isEphemeralPreviewUrl(str)) {
    throw new Error('أعد رفع صورة عرض المحاكي «' + simId + '» قبل النشر.');
  }
  if (!rejectDataUrl(str)) return str;
  if (isDataUrlSvg(str)) {
    var svgFile = await dataUrlToFile(str, safeSimId(simId) + '-showcase.svg');
    return uploadShowcaseImage(simId, svgFile);
  }
  var rasterFile = await dataUrlToFile(str, safeSimId(simId) + '-showcase.webp');
  return uploadShowcaseImage(simId, rasterFile);
}

function catalogIdsFromPayload(payload) {
  if (window.PlatformSimulators && Array.isArray(window.PlatformSimulators.CATALOG)) {
    return window.PlatformSimulators.CATALOG.map(function (s) {
      return String(s.id || '');
    }).filter(Boolean);
  }
  var ids = {};
  var meta = (payload && payload.simulatorsMeta) || {};
  var showcase = (payload && (payload.showcaseMeta || payload.showcaseStore)) || {};
  Object.keys(meta).forEach(function (id) {
    ids[id] = true;
  });
  Object.keys(showcase).forEach(function (id) {
    if (id.charAt(0) !== '_') ids[id] = true;
  });
  return Object.keys(ids);
}

/**
 * Upload pending / base64 media and replace with Storage URLs before Firestore write.
 */
export async function prepareSimulatorsPayloadForFirestore(payload, pendingIcons, pendingShowcase, onProgress) {
  var src = payload && typeof payload === 'object' ? payload : {};
  var meta = Object.assign({}, src.simulatorsMeta || {});
  var showcase = Object.assign({}, src.showcaseMeta || src.showcaseStore || {});
  var pendingIconMap = pendingIcons && typeof pendingIcons === 'object' ? pendingIcons : {};
  var pendingShowcaseMap = pendingShowcase && typeof pendingShowcase === 'object' ? pendingShowcase : {};
  var reportProgress = typeof onProgress === 'function' ? onProgress : function () {};

  var ids = catalogIdsFromPayload(src);
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    var stepBase = 30 + Math.round((i / Math.max(ids.length, 1)) * 45);
    reportProgress(stepBase);
    console.log('[CMS] Processing simulator media:', id, '(' + (i + 1) + '/' + ids.length + ')');

    var metaEntry = meta[id];
    if (metaEntry && metaEntry.iconType === 'image') {
      console.log('[CMS] Resolving icon for', id);
      meta[id] = Object.assign({}, metaEntry, {
        icon: await resolveSimulatorIconUrl(id, metaEntry.icon, pendingIconMap[id]),
      });
    }
    var showcaseEntry = showcase[id];
    if (showcaseEntry && showcaseEntry.showcaseImage) {
      console.log('[CMS] Resolving showcase image for', id);
      showcase[id] = Object.assign({}, showcaseEntry, {
        showcaseImage: await resolveShowcaseImageUrl(
          id,
          showcaseEntry.showcaseImage,
          pendingShowcaseMap[id]
        ),
      });
    }
  }

  reportProgress(78);

  return Object.assign({}, src, {
    simulatorsMeta: meta,
    showcaseMeta: showcase,
  });
}

export function assertNoDataUrlsInSimulatorsPayload(payload) {
  var meta = (payload && payload.simulatorsMeta) || {};
  var showcase = (payload && (payload.showcaseMeta || payload.showcaseStore)) || {};
  Object.keys(meta).forEach(function (id) {
    var entry = meta[id];
    if (entry && entry.iconType === 'image' && rejectDataUrl(entry.icon)) {
      throw new Error(
        'أيقونة المحاكي «' + id + '» ما زالت base64 — أعد رفع الصورة أو احفظ مرة أخرى.'
      );
    }
  });
  Object.keys(showcase).forEach(function (id) {
    if (id.charAt(0) === '_') return;
    var entry = showcase[id];
    if (entry && entry.showcaseImage && rejectDataUrl(entry.showcaseImage)) {
      throw new Error(
        'صورة عرض المحاكي «' + id + '» ما زالت base64 — أعد رفع الصورة أو احفظ مرة أخرى.'
      );
    }
  });
}
