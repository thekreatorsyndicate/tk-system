/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as chat from "../chat.js";
import type * as chatInternal from "../chatInternal.js";
import type * as debug from "../debug.js";
import type * as documents from "../documents.js";
import type * as knowledgeBases from "../knowledgeBases.js";
import type * as lib_documentTypes from "../lib/documentTypes.js";
import type * as modules from "../modules.js";
import type * as processDocument from "../processDocument.js";
import type * as processDocumentAction from "../processDocumentAction.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  chat: typeof chat;
  chatInternal: typeof chatInternal;
  debug: typeof debug;
  documents: typeof documents;
  knowledgeBases: typeof knowledgeBases;
  "lib/documentTypes": typeof lib_documentTypes;
  modules: typeof modules;
  processDocument: typeof processDocument;
  processDocumentAction: typeof processDocumentAction;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
