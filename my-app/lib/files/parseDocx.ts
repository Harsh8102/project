import mammoth from "mammoth";

/** Plain text extraction from a .docx buffer — used for the prose-rates and format-violation cases. */
export async function parseDocxToText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}
