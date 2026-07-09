const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const multer = require("multer");

function storage(folder) {
  return multer.diskStorage({
    destination: (_req, _file, cb) => {
      const destination = path.join(__dirname, "..", "uploads", folder);
      fs.mkdirSync(destination, { recursive: true });
      cb(null, destination);
    },
    filename: (_req, file, cb) => cb(null, `${crypto.randomBytes(16).toString("hex")}${path.extname(file.originalname).toLowerCase()}`),
  });
}

function imageUpload(folder) {
  return multer({
    storage: storage(folder),
    limits: { fileSize: 4 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!file.mimetype.startsWith("image/")) return cb(new Error("Only images are allowed."));
      cb(null, true);
    },
  });
}

function fileToDataUrl(file) {
  if (!file) return null;
  const data = fs.readFileSync(file.path).toString("base64");
  fs.unlink(file.path, () => {});
  return `data:${file.mimetype};base64,${data}`;
}

module.exports = { imageUpload, fileToDataUrl };
