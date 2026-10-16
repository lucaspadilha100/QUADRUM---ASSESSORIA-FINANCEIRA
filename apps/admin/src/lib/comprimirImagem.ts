// Foto de perfil: recorta o centro em quadrado e reduz para 256×256 (WEBP;
// JPEG onde o navegador não gera WEBP). Uma foto de celular de 4 MB vira ~15 KB
// — é ela que carrega no topo de todas as telas.

export async function comprimirFoto(arquivo: File, lado = 256): Promise<Blob> {
  if (!arquivo.type.startsWith("image/")) throw new Error("Escolha uma imagem.");
  const bitmap = await createImageBitmap(arquivo).catch(() => { throw new Error("Não foi possível ler esta imagem."); });
  const corte = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = lado;
  canvas.height = lado;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não foi possível processar a imagem.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, (bitmap.width - corte) / 2, (bitmap.height - corte) / 2, corte, corte, 0, 0, lado, lado);
  bitmap.close?.();
  const gerar = (tipo: string, q: number) => new Promise<Blob | null>((ok) => canvas.toBlob(ok, tipo, q));
  const webp = await gerar("image/webp", 0.82);
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await gerar("image/jpeg", 0.85);
  if (!jpeg) throw new Error("Não foi possível processar a imagem.");
  return jpeg;
}
