/**
 * Naming and the batch CSV — the parts of `download.js` that are pure.
 *
 * The ZIP writer is exercised end to end by `npm run features`, which
 * downloads a real archive from a real batch; what is left here is the
 * string handling, which is where the awkward inputs are.
 */
import { describe, it, expect } from "vitest";
import { outputName, metricsCsv } from "./download.js";

describe("outputName", () => {
  it("replaces the extension rather than appending to it", () => {
    expect(outputName("portrait.jpg", "-2x", "png")).toBe("portrait-2x.png");
  });

  it("keeps dots that are part of the name", () => {
    expect(outputName("holiday.2019.summer.jpeg", "-4x", "png")).toBe("holiday.2019.summer-4x.png");
  });

  it("copes with no extension at all", () => {
    expect(outputName("scan", "-2x", "png")).toBe("scan-2x.png");
  });

  it("falls back rather than producing a file called '.png'", () => {
    expect(outputName(undefined, "-2x", "png")).toBe("image-2x.png");
    expect(outputName("", "-2x", "png")).toBe("image-2x.png");
    // A name that is nothing but an extension would leave an empty stem.
    expect(outputName(".jpg", "-2x", "png")).toBe("image-2x.png");
  });
});

describe("metricsCsv", () => {
  const read = async (blob) => await blob.text();

  it("writes a header and one row per image", async () => {
    const csv = await read(metricsCsv([
      { name: "a.jpg", metrics: { input_width: 100, input_height: 200, output_width: 200, output_height: 400, psnr: 27.8512, ssim: 0.94623, sharpness_before: 58.15, sharpness_after: 546.86, noise_before: 1.4041, noise_after: 1.4283 } },
      { name: "b.jpg", metrics: {} },
    ]));
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0].startsWith("file,input_width")).toBe(true);
    // Rounded for reading, not truncated to something wrong.
    expect(lines[1]).toBe("a.jpg,100,200,200,400,27.85,0.9462,58.15,546.86,1.404,1.428");
    // A row with no measurements is still a row, with empty cells.
    expect(lines[2]).toBe("b.jpg,,,,,,,,,,");
  });

  it("quotes a filename containing a comma or a quote", async () => {
    const csv = await read(metricsCsv([{ name: 'holiday, "best" one.jpg', metrics: {} }]));
    expect(csv.split("\n")[1]).toBe('"holiday, ""best"" one.jpg",,,,,,,,,,');
  });

  it("distinguishes a measurement of zero from a missing one", async () => {
    // `?? ""` on a falsy number is the classic way this goes wrong: a
    // perfectly flat image really does measure 0 sharpness, and reporting
    // that as "no data" is a different claim.
    const csv = await read(metricsCsv([{ name: "flat.png", metrics: { input_width: 0, psnr: 0, ssim: 0, sharpness_before: 0 } }]));
    // file,input_width,input_height,output_width,output_height,psnr_db,
    // ssim,sharpness_before,... — count them, do not guess.
    const cells = csv.split("\n")[1].split(",");
    expect(cells[1]).toBe("0"); // input_width
    expect(cells[5]).toBe("0.00"); // psnr_db
    expect(cells[6]).toBe("0.0000"); // ssim
    expect(cells[7]).toBe("0.00"); // sharpness_before
  });
});
