const momentImageMaxBytes = 3 * 1024 * 1024;
const chatImageMaxBytes = 2 * 1024 * 1024;
const chatImageMaxSourceBytes = 20 * 1024 * 1024;

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file?.type?.startsWith('image/')) {
      reject(new Error('请选择图片文件'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

function dataUrlForFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

async function readMomentImageFile(file) {
  if (!file?.type?.startsWith('image/')) {
    throw new Error('请选择图片文件');
  }
  if (file.size > momentImageMaxBytes) {
    throw new Error('回忆图片需为 3MB 以内');
  }
  return dataUrlForFile(file);
}

function estimateDataUrlBytes(dataUrl) {
  const match = String(dataUrl || '').match(/^data:image\/[^;]+;base64,([a-zA-Z0-9+/=]+)$/);
  if (!match) return Number.POSITIVE_INFINITY;
  const base64 = match[1];
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function loadImageElement(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片解析失败'));
    image.src = dataUrl;
  });
}

async function compressImageDataUrl(dataUrl, maxBytes, onProgress) {
  if (estimateDataUrlBytes(dataUrl) <= maxBytes) {
    onProgress?.(1);
    return dataUrl;
  }
  const image = await loadImageElement(dataUrl);
  onProgress?.(0.45);
  let maxEdge = 1920;
  let quality = 0.86;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const scale = Math.min(1, maxEdge / Math.max(image.width, image.height, 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('图片压缩失败');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const next = canvas.toDataURL('image/jpeg', quality);
    onProgress?.(0.5 + attempt * 0.05);
    if (estimateDataUrlBytes(next) <= maxBytes) {
      onProgress?.(1);
      return next;
    }
    if (quality > 0.52) quality -= 0.08;
    else maxEdge = Math.floor(maxEdge * 0.78);
  }
  throw new Error('临时图片需为 2MB 以内的图片');
}

async function readChatImageFile(file, { onProgress } = {}) {
  if (!file?.type?.startsWith('image/')) {
    throw new Error('请选择图片文件');
  }
  if (file.size > chatImageMaxSourceBytes) {
    throw new Error('图片过大，请选择 20MB 以内的图片');
  }
  onProgress?.(0.15);
  const keepOriginal =
    (file.type === 'image/gif' || file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'image/webp')
    && file.size <= chatImageMaxBytes;
  if (keepOriginal) {
    const dataUrl = await dataUrlForFile(file);
    onProgress?.(1);
    return dataUrl;
  }
  const dataUrl = await dataUrlForFile(file);
  onProgress?.(0.35);
  return compressImageDataUrl(dataUrl, chatImageMaxBytes, onProgress);
}

export {
  momentImageMaxBytes,
  chatImageMaxBytes,
  readImageFile,
  dataUrlForFile,
  readMomentImageFile,
  readChatImageFile
};
