export function buildFileTree(files = []) {
  const root = [];

  if (!Array.isArray(files)) return root;

  files.forEach((file) => {
    const fullPath = file?.filename;
    if (!fullPath) return;

    const parts = fullPath.split("/");

    let currentLevel = root;

    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;

      let existing = currentLevel.find((node) => node.name === part);

      if (!existing) {
        existing = {
          name: part,
          type: isFile ? "file" : "folder",
          children: [],
        };
        currentLevel.push(existing);
      }

      if (!isFile) {
        currentLevel = existing.children;
      } else {
        existing.fileData = file;
      }
    });
  });

  return root;
}
