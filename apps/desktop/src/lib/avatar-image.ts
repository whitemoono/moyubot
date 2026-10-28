/** Keep avatar images small and independent of the original file location. */
export async function readAvatar(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('请选择 PNG、JPG、WebP 或 GIF 图片');
  if (file.size > 8 * 1024 * 1024) throw new Error('头像图片不能超过 8 MB');
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context || !bitmap.width || !bitmap.height) throw new Error('无法读取这张图片，请换一张试试');
    const side = Math.min(bitmap.width, bitmap.height);
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
    return canvas.toDataURL('image/webp', .9);
  } finally { bitmap.close(); }
}
