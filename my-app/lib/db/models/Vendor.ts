import { Schema, model, models, Types, type InferSchemaType } from "mongoose";

const VendorSchema = new Schema(
  {
    name: { type: String, required: true },
    // Vendor A-E label used throughout the UI and fixtures for readability.
    code: { type: String, required: true, unique: true },
  },
  { timestamps: true }
);

export type Vendor = InferSchemaType<typeof VendorSchema> & { _id: Types.ObjectId };

export const VendorModel = models.Vendor || model("Vendor", VendorSchema);
