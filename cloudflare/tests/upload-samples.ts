/** Valid allowlisted file fixtures for upload tests (correct magic bytes). */
export function samplePdfFile(name = "document.pdf", type = "application/pdf"): File {
  return new File(["%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"], name, { type });
}

export function samplePngFile(name = "document.png", type = "image/png"): File {
  const bytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
    0xae, 0x42, 0x60, 0x82
  ]);
  return new File([bytes], name, { type });
}

export function sampleJpegFile(name = "document.jpg", type = "image/jpeg"): File {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
  return new File([bytes], name, { type });
}

export function sampleWebpFile(name = "document.webp", type = "image/webp"): File {
  const bytes = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50
  ]);
  return new File([bytes], name, { type });
}
