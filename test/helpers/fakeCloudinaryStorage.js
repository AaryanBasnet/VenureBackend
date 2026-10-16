// Stand-in for multer-storage-cloudinary: same multer storage contract, no network. Use it with
//   jest.mock("multer-storage-cloudinary", () => require("./helpers/fakeCloudinaryStorage"));
// An uploaded file comes back as {path, filename} exactly like a Cloudinary upload would.
class CloudinaryStorage {
  _handleFile(req, file, cb) {
    let size = 0;
    file.stream.on("data", (chunk) => { size += chunk.length; });
    file.stream.on("error", cb);
    file.stream.on("end", () => cb(null, {
      path: `https://res.cloudinary.com/test/${file.fieldname}/${file.originalname}`,
      filename: `test/${file.originalname}`,
      size,
    }));
    file.stream.resume();
  }

  _removeFile(req, file, cb) {
    cb(null);
  }
}

module.exports = { CloudinaryStorage };
