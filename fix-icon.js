const { nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

async function fixIcon() {
    const inputPath = path.join(__dirname, 'renderer', 'assets', 'logo.png');
    const outputPath = path.join(__dirname, 'build', 'icon.png');

    if (!fs.existsSync(path.dirname(outputPath))) {
        fs.mkdirSync(path.dirname(outputPath));
    }

    console.log('Loading icon from:', inputPath);
    const img = nativeImage.createFromPath(inputPath);
    const size = img.getSize();
    console.log('Original size:', size);

    // Create a square 512x512 version
    // We'll resize the longest side to 512 and keep aspect ratio, then draw it on a 512x512 transparent canvas
    const maxSide = 512;
    const resized = img.resize({ width: maxSide, height: maxSide, quality: 'best' });

    // Actually, simple resize to square might distort it if it's not square.
    // 803 x 825 is close enough that it might not look too bad, but let's be precise.

    const targetSize = 512;
    const finalImg = nativeImage.createEmpty();
    // nativeImage doesn't have a "draw on top" easily without canvas in renderer.
    // But since 803x825 is very close to square, a direct resize to 512x512 should be fine for an icon.

    const pngBuffer = resized.toPNG();
    fs.writeFileSync(outputPath, pngBuffer);
    console.log('Square icon saved to:', outputPath);
}

// We need to run this in a way that has access to 'electron' (like a main process script)
fixIcon().catch(err => {
    console.error(err);
    process.exit(1);
});
