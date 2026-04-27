import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type CategoryDocument = Category & Document & { id: string };

@Schema({ timestamps: true })
export class Category {
  @Prop({ required: true, unique: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true })
  normalizedName: string;

  @Prop({ required: true })
  slug: string;

  @Prop({ required: true, default: '' })
  path: string;

  @Prop({ default: 0 })
  depth: number;

  @Prop({ type: Types.ObjectId, ref: 'Category', default: null })
  parentId: Types.ObjectId | null;

  @Prop({ default: true })
  isActive: boolean;
}

export const CategorySchema = SchemaFactory.createForClass(Category);

CategorySchema.set('toJSON', { virtuals: true });
CategorySchema.set('toObject', { virtuals: true });

CategorySchema.index({ slug: 1 });
CategorySchema.index({ path: 1 });
CategorySchema.index({ parentId: 1 });
CategorySchema.index({ isActive: 1 });