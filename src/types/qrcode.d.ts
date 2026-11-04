declare module 'qrcode/lib/core/qrcode' {
  const QRCodeCore: {
    create(text: string, opts?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' }): { modules: { size: number; data: Uint8Array } };
  };
  export default QRCodeCore;
}
