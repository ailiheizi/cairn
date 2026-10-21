export const UPLOAD_MAX_FILES = 200;
const MAX_PATH_BYTES = 2048;
const MAX_COMPONENT_BYTES = 240;
const MAX_COMPONENTS = 16;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;

function isWellFormed(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export function inspectFolderUpload(files: readonly File[]): { paths?: string[]; problem?: string } {
  if (files.length === 0) return { problem: "Choose a folder that contains files." };
  if (files.length > UPLOAD_MAX_FILES) return { problem: "A folder upload can contain at most 200 files." };
  const encoder = new TextEncoder();
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const path = file.webkitRelativePath;
    if (!path || !isWellFormed(path)) return { problem: "The browser did not provide a valid relative path for every selected file." };
    if (encoder.encode(path).byteLength > MAX_PATH_BYTES) return { problem: "A selected folder path exceeds 2048 UTF-8 bytes." };
    if (path.startsWith("/") || path.includes("\\") || path.includes(":")) return { problem: "Folder paths must use safe relative slash-separated components." };
    const components = path.split("/");
    if (components.length > MAX_COMPONENTS) return { problem: "A selected folder path exceeds 16 components." };
    for (const component of components) {
      if (!component || component === "." || component === "..") return { problem: "A selected folder path contains an empty, dot, or dot-dot component." };
      if (encoder.encode(component).byteLength > MAX_COMPONENT_BYTES) return { problem: "A folder path component exceeds 240 UTF-8 bytes." };
      if (CONTROL_CHARACTERS.test(component)) return { problem: "A selected folder path contains a control character." };
      if (component.endsWith(".") || component.endsWith(" ")) return { problem: "Folder path components cannot end in a dot or space." };
      if (WINDOWS_RESERVED.test(component)) return { problem: "A folder path contains a reserved device name." };
    }
    if (seen.has(path)) return { problem: "The folder selection contains a duplicate relative path." };
    seen.add(path);
    paths.push(path);
  }
  return { paths };
}
