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

// Comprovante de pagamento: mantém a proporção, lado maior até 1600 px (ainda
// legível: valor, data, código), WEBP (JPEG onde não há WEBP). Uma foto de
// celular de 3–5 MB vira ~150–300 KB. PDF não se mexe: até 3 MB.
// Anexo de cadastro (RG, CRLV, contrato do financiamento, documento assinado):
// mesma redução para foto; PDF até 8 MB (contrato de banco tem muitas páginas).
export const LIMITE_PDF = 3 * 1024 * 1024;
export const LIMITE_PDF_ANEXO = 8 * 1024 * 1024;

export const comprimirComprovante = (arquivo: File) => comprimirArquivo(arquivo, LIMITE_PDF);
export const comprimirAnexo = (arquivo: File) => comprimirArquivo(arquivo, LIMITE_PDF_ANEXO);

async function comprimirArquivo(arquivo: File, limitePdf: number): Promise<Blob> {
  if (arquivo.type === "application/pdf") {
    if (arquivo.size > limitePdf) throw new Error(`PDF acima de ${limitePdf / 1024 / 1024} MB. Envie uma foto ou um PDF menor.`);
    return arquivo;
  }
  if (!arquivo.type.startsWith("image/")) throw new Error("Envie uma foto ou um PDF.");
  const bitmap = await createImageBitmap(arquivo).catch(() => { throw new Error("Não foi possível ler esta imagem."); });
  const escala = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não foi possível processar a imagem.");
  ctx.fillStyle = "#fff"; // PNG transparente não vira fundo preto no JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const gerar = (tipo: string, q: number) => new Promise<Blob | null>((ok) => canvas.toBlob(ok, tipo, q));
  const webp = await gerar("image/webp", 0.75);
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await gerar("image/jpeg", 0.8);
  if (!jpeg) throw new Error("Não foi possível processar a imagem.");
  return jpeg;
}
