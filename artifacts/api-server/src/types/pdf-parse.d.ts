declare module "pdf-parse" { function pdfParse(buf: Buffer): Promise<{ text: string; numpages: number; info: any }>; export default pdfParse; }
