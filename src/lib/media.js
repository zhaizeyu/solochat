const momentImageMaxBytes = 3 * 1024 * 1024;

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

export { momentImageMaxBytes, readImageFile, dataUrlForFile, readMomentImageFile };
