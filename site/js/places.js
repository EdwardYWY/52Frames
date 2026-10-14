// Where each TGV cinema is, by TGV cinema id: [latitude, longitude].
//
// TGV's own data only gives coordinates for some cinemas (inside a Google Maps link in the
// sessions response), and at least one of those is wrong. These were looked up once from
// OpenStreetMap (© OpenStreetMap contributors, ODbL) and checked by hand; a few are only accurate
// to about 1 km. GSC sends coordinates in its cinema list, so it needs no table.
// New TGV cinema missing here? It falls back to TGV's map link, or shows no distance.

export const TGV_LOCATIONS = {
  "1SM": [3.12201, 101.73995], // 1 Shamelin
  "BU0": [3.14947, 101.61564], // 1 Utama
  "1AV": [5.41337, 100.33131], // 1St Avenue Penang
  "ALM": [2.93957, 101.71028], // Alamanda
  "AMP": [3.15781, 101.75095], // Ampang Point
  "AU2": [3.17759, 101.74961], // Au2 Setiawangsa
  "BIN": [3.20075, 113.04722], // Boulevard Bintulu
  "BI0": [1.48153, 103.65582], // Bukit Indah
  "BKM": [5.32018, 100.47826], // Bukit Mertajam
  "BR0": [3.06203, 101.47115], // Bukit Raja
  "BBT": [2.99468, 101.4455], // Bukit Tinggi
  "ICT": [3.06254, 101.48193], // Central I-City
  "CHR": [3.03336, 101.76289], // Cheras Selatan
  "CTR": [3.07758, 101.74353], // Cheras Sentral
  "CYB": [2.92209, 101.65108], // Dpulze Cyberjaya
  "GUR": [5.4358, 100.31103], // Gurney Paragon
  "JAY": [3.10902, 101.63705], // Jaya Seksyen 14
  "KP0": [3.21411, 101.6395], // Kepong
  "IP0": [4.61357, 101.11871], // Kinta City
  "KUL": [1.64042, 103.61718], // Kulaijaya
  "MSR": [4.44059, 103.44749], // Mesra Mall
  "MN0": [3.02795, 101.7184], // Mines
  "IMP": [4.39922, 113.9903], // Miri
  "PBJ": [3.05106, 101.67051], // Pavilion Bukit Jalil
  "PDH": [3.146, 101.66333], // Pavilion Damansara Heights (New)
  "PKL": [3.14915, 101.71295], // Pavilion Kuala Lumpur (New)
  "RWK": [3.31665, 101.5365], // Rawang
  "KLE": [4.66036, 101.10962], // Sentra Mall Klebang
  "S20": [2.70182, 101.91189], // Seremban 2
  "MAN": [4.21972, 100.67115], // Seri Manjung
  "STW": [3.02884, 101.61523], // Setiawalk Puchong
  "S18": [4.5457, 101.07033], // Station 18 Ipoh
  "STR": [3.15559, 101.59368], // Strand Kota Damansara
  "SWP": [3.16639, 101.69239], // Sunway Putra
  "SW0": [3.07249, 101.60655], // Sunway Pyramid
  "SWS": [3.0646, 101.60579], // Sunway Square (New)
  "SWV": [3.12736, 101.72402], // Sunway Velocity
  "WWM": [3.1991, 101.74147], // Sunway Wangsa Mall
  "KLC": [3.15738, 101.71238], // Suria Klcc
  "TAI": [4.87243, 100.72928], // Taiping
  "TSC": [1.51413, 103.65444], // Tasek Central
  "TBR": [1.54952, 103.79578], // Tebrau City
  "KSL": [2.95785, 101.46617], // Tgv Ksl Klang (New)
  "TOP": [1.55293, 103.79785], // Toppen
  "VIV": [1.5268, 110.3693], // Vivacity Kuching
};
