const fs = require('fs');
const path = require('path');
const multer = require('multer');

const isServerless = Boolean(process.env.VERCEL || process.env.SERVERLESS === 'true');
let storage;

if (isServerless) {
  // Vercel serverless filesystem is read-only; keep uploaded images in memory
  storage = multer.memoryStorage();
} else {
  const uploadDir = path.join(__dirname, '../../uploads');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
    }
  });
}

const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/jpg'];
  const allowedExtensions = /\.(jpeg|jpg|png)$/i;
  const ext = path.extname(file.originalname).toLowerCase();

  // Validate both MIME type and file extension
  if (allowedMimeTypes.includes(file.mimetype) && allowedExtensions.test(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPG, JPEG, and PNG images are allowed!'), false);
  }
};

const upload = multer({
  storage,
  limits: {
    fileSize: isServerless ? 4 * 1024 * 1024 : 5 * 1024 * 1024
  },
  fileFilter
});

module.exports = upload;
