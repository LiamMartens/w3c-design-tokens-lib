export type TTokenLibraryMap<
TokenTypeMap extends Record<string, unknown>,
Ext extends Record<string, unknown> = Record<string, unknown>
> = {
  [T in keyof TokenTypeMap]: {
    $type?: T;
    // @README tokens can always be of a string value
    // because it can be a singular reference to another token
    $value?: string | TokenTypeMap[T];
    $description?: string;
    $extensions?: Ext;
  }
}