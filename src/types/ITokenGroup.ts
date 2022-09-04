import type { TTokenLibraryMap } from './TTokenLibraryMap';

export interface ITokenGroup<
Map extends TTokenLibraryMap<any, any>,
Ext extends Record<string, unknown>
>
  extends Record<
  Exclude<string, '$type' | '$description' | '$value' | '$extensions'>,
  undefined | keyof Map | string | Ext | ITokenGroup<Map, Ext> | Map[keyof Map]
> {
  $type?: keyof Map;
  $description?: string;
  $extensions?: Ext;
}
