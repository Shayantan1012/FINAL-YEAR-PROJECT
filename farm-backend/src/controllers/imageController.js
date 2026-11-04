import sharp from "sharp";
import { z } from "zod";
import { ProductImage } from "../models/ProductImage.js";
import { ensure } from "../lib/errors.js";
import { id } from "../lib/validation.js";

export async function uploadImage(req, res) {
  const { base64 } = z
    .object({
      base64: z
        .string()
        .min(4)
        .max(7_000_000)
        .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    })
    .strict()
    .parse(req.body);
  const input = Buffer.from(base64, "base64");
  ensure(input.length <= 5 * 1024 * 1024, 413, "Image must be 5 MB or smaller");
  let output;
  try {
    const processor = sharp(input, { limitInputPixels: 25_000_000 });
    const metadata = await processor.metadata();
    ensure(
      ["jpeg", "png", "webp"].includes(metadata.format),
      400,
      "Choose a JPEG, PNG or WebP photo",
    );
    output = await processor
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch {
    ensure(
      false,
      400,
      "Invalid image. Choose a JPEG, PNG or WebP photo under 25 megapixels.",
    );
  }
  const image = await ProductImage.create({
    owner: req.user._id,
    data: output,
  });
  res.status(201).json({ image: "/api/images/" + image.id });
}
export async function getImage(req, res) {
  const image = await ProductImage.findById(id.parse(req.params.id)).select(
    "+data",
  );
  ensure(image, 404, "Photo not found");
  res.set("Cross-Origin-Resource-Policy", "cross-origin");
  res.set("Cache-Control", "public, max-age=86400");
  res.type("image/jpeg").send(image.data);
}
export async function validateImageOwner(image, owner) {
  if (!image?.startsWith("/api/images/")) return;
  ensure(
    await ProductImage.exists({ _id: image.split("/").pop(), owner }),
    403,
    "Upload your own product photo",
  );
}
