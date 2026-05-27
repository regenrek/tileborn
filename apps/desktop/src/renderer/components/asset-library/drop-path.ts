export function readDroppedImportPath(event: {
  readonly dataTransfer: DataTransfer | null;
}): string | undefined {
  const transfer = event.dataTransfer;
  if (!transfer) {
    return undefined;
  }

  const file = transfer.files[0];
  if (!file) {
    return undefined;
  }

  const filePath = (file as File & { path?: string }).path;
  if (typeof filePath === 'string' && filePath.length > 0) {
    return filePath;
  }

  return undefined;
}
