/** Copyright 2026 GetMCPAds. SPDX-License-Identifier: Apache-2.0 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/** Ported from the getmcpads gateway: Amazon OpenAPI request schemas become strict zod validators and exact wire values. */
import { z } from "zod";
import { AmazonInteger } from "../core/json.js";
import { id } from "./shared.js";
export type NativeSchema = { type?:string; properties?:Record<string,NativeSchema>; required?:string[]; enum?:any[]; items?:NativeSchema; anyOf?:NativeSchema[]; oneOf?:NativeSchema[]; additionalProperties?:boolean|NativeSchema; nullable?:boolean; description?:string; minimum?:number; maximum?:number; minLength?:number; maxLength?:number; pattern?:string; minItems?:number; maxItems?:number };
export function combinedSchema(s: NativeSchema): NativeSchema {
  const choices = s.anyOf;
  if (!choices) return s;
  // SD explicitly permits combinations of headline, logo, image and background properties.
  if (choices.every(c=>c.type === "object" || c.properties)) return { ...s, type:"object", properties:Object.assign({}, ...choices.map(c=>c.properties), s.properties), required:s.required };
  return s;
}
export function nativeSchema(s: NativeSchema, field = ""): z.ZodTypeAny {
  const n = combinedSchema(s);
  let v: z.ZodTypeAny;
  if (["campaignId","adGroupId","adId","keywordId","targetId","creativeId","portfolioId"].includes(field) || (n.type === "integer" || n.type === "number") && /Id$/.test(field)) v = id.describe("Native integer identifier. Supply decimal digits as a string to preserve all digits.");
  else if (n.type === "object" || n.properties) {
    const fields:Record<string,z.ZodTypeAny> = {};
    for (const [key, child] of Object.entries(n.properties ?? {})) {
      const value = nativeSchema(child,key);
      fields[key] = n.required?.includes(key) ? value : value.optional();
    }
    const obj = z.object(fields);
    v = typeof n.additionalProperties === "object" ? obj.catchall(nativeSchema(n.additionalProperties)) : n.additionalProperties === true ? obj.passthrough() : obj.strict();
    const choices=s.anyOf??s.oneOf;
    if (choices) v=v.refine(value=>{const o=value as Record<string,unknown>;return choices.some(c=>(c.required??[]).every(k=>o[k]!==undefined)) && Object.keys(o).length>0;},"Provide at least one complete native creative property.");
  } else if (n.enum?.length) v = z.union(n.enum.map(x=>z.literal(x)) as any);
  else if (n.type === "array") {
    let arr = z.array(nativeSchema(n.items ?? {}));
    if (n.minItems!==undefined) arr=arr.min(n.minItems);
    arr=arr.max(Math.min(n.maxItems??100,1000));v=arr;
  } else if (n.type === "integer" || n.type === "number") {
    let num=z.number().finite();if(n.type==="integer")num=num.int().safe();
    if(n.minimum!==undefined)num=num.min(n.minimum);if(n.maximum!==undefined)num=num.max(n.maximum);v=num;
  } else if (n.type === "boolean") v=z.boolean();
  else if (n.type === "string") {
    let str=z.string();if(n.minLength!==undefined)str=str.min(n.minLength);str=str.max(n.maxLength??8192);
    if(n.pattern)str=str.regex(new RegExp(n.pattern));v=str;
  } else if(n.anyOf || n.oneOf) v=z.union((n.anyOf??n.oneOf)!.map(c=>nativeSchema(c,field)) as any);
  else v=z.unknown();
  if(n.nullable)v=v.nullable();if(n.description)v=v.describe(n.description);return v;
}
export function nativeWire(value:any,s:NativeSchema,field=""):any {
  if(value===null||value===undefined)return value;
  const n=combinedSchema(s);
  if(n.oneOf){const choice=n.oneOf.find(c=>nativeSchema(c,field).safeParse(value).success);if(!choice)throw new Error("Invalid native expression.");return nativeWire(value,choice,field);}
  if((n.type==="integer"||n.type==="number")&&/Id$/.test(field))return new AmazonInteger(value);
  if(Array.isArray(value))return value.map(v=>nativeWire(v,n.items??{}));
  if(typeof value==="object")return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,nativeWire(v,n.properties?.[k]??{},k)]));
  return value;
}
