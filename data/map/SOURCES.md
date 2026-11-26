# Map data sources

Raw files live in git-ignored `tools/raw/`. Only processed output is used by the game, which downloads nothing.

| File in `tools/raw/` | Source | License |
|---|---|---|
| `ne_10m_land.geojson`, `ne_10m_lakes.geojson`, `ne_10m_rivers_north_america.geojson` | Natural Earth 1:10m, via `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/<name>.geojson` (10.2, 5.0 and 8.7 MB) | Public domain |
| `etopo_<col>_<row>.tile` (6 files, about 1.1 MB in all) | NOAA NCEI ETOPO 2022, 60 arc-second surface elevation, `https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/data/60s/60s_surface_elev_gtif/ETOPO_2022_v1_60s_N90W180_surface.tif` | NOAA public data; cite NOAA NCEI |

The ETOPO file is one 466 MB global GeoTIFF, 21600 x 10800 samples, in 256 x 256 deflate tiles. Only the six tiles at columns 23 to 25, rows 11 and 12 (about 33 to 43 N, 82 to 69 W) were fetched, by HTTP range request. Each tile's byte range comes from the TIFF's tile offset (tag 324) and byte count (tag 325) arrays in the first 256 KB of the file. The raw tile bytes were saved as they are; `tools/map/tiff.ts` decodes them.

Rebuild everything with `node tools/build-map.mjs 25`.

## Roads (E5.2)

| File in `tools/raw/` | Source | License |
|---|---|---|
| `tiger/tl_2024_us_primaryroads.shp`, `.dbf` | US Census Bureau TIGER/Line 2024, primary roads, `https://www2.census.gov/geo/tiger/TIGER2024/PRIMARYROADS/tl_2024_us_primaryroads.zip` (38.3 MB zipped, 61 MB unpacked) | US government work, public domain; cite the US Census Bureau |

`data/map/roads.json` chooses the roads by name.
