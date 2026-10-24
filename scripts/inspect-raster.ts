// Prints the structural metadata of a GeoTIFF so dataset semantics can be checked before use.
import { fromFile } from 'geotiff';

const path = process.argv[2];
if (!path) throw new Error('usage: node scripts/inspect-raster.ts <file.tif>');
const tiff = await fromFile(path);
const img = await tiff.getImage();
console.log(JSON.stringify({
  width: img.getWidth(),
  height: img.getHeight(),
  tileWidth: img.getTileWidth(),
  tileHeight: img.getTileHeight(),
  samplesPerPixel: img.getSamplesPerPixel(),
  origin: img.getOrigin(),
  resolution: img.getResolution(),
  bbox: img.getBoundingBox(),
  geoKeys: img.getGeoKeys(),
  gdalNoData: img.getGDALNoData(),
  imageCount: await tiff.getImageCount(),
}, null, 2));
await tiff.close?.();
