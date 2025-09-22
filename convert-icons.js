const sharp = require("sharp");
const fs = require("fs");

const svgBuffer = fs.readFileSync("temp_icon.svg");

const sizes = [16, 32, 48, 128];

async function convertIcons() {
  for (const size of sizes) {
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(`public/icons/icon${size}.png`);
    console.log(`Created icon${size}.png`);
  }
}

convertIcons()
  .then(() => {
    console.log("All icons created successfully!");
  })
  .catch((err) => {
    console.error("Error creating icons:", err);
  });
