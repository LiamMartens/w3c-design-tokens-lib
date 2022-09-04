import pick from 'just-pick';
import get from 'just-safe-get';
import set from 'just-safe-set';
import compact from 'just-compact';
import traverse from 'json-schema-traverse';
import type { ITokenGroup, TTokenLibraryMap } from './types';
import { tokenGroupChildrenSchema, tokenGroupObjectSchema, tokenSchema } from './zod';
import extend from 'just-extend';
import { z } from 'zod';
import { ResolveError } from './error';

type TokenOrGroup<Map extends TTokenLibraryMap<any, any>, Ext extends Record<string, unknown>> = (
  Map[keyof Map] | Pick<ITokenGroup<Map, Ext>, '$type' | '$description' | '$extensions'>
)

export class Library<
Map extends TTokenLibraryMap<any, any>,
Ext extends Record<string, unknown>,
Validators extends Record<keyof Map, z.ZodType>
> {
  private $tokens: ITokenGroup<Map, Ext>;
  private $validators: Partial<Validators>;
  private $subscribers: (
    (mutations: [string, TokenOrGroup<Map, Ext> | null][] | null, $tokens: ITokenGroup<Map, Ext>) => void
  )[] = [];

  constructor($tokens: ITokenGroup<Map, Ext>, $validators: Partial<Validators> = {}) {
    this.$tokens = $tokens;
    this.$validators = $validators;
  }

  public load($tokens: ITokenGroup<Map, Ext>) {
    this.$tokens = $tokens;
    this.$subscribers.forEach((fn) => fn(null, this.$tokens));
  }

  public get(token: string) {
    const path = token.split(/[\.\/]/).join('.')
    const tokenObject = get(this.$tokens, path, null);
    const validationResult = tokenSchema.or(tokenGroupObjectSchema).safeParse(tokenObject);
    if (validationResult.success) {
      return [path, validationResult.data] as [string, TokenOrGroup<Map, Ext>];
    }
    return null;
  }

  public resolveValue(value: Map[keyof Map]['$value'], throwOnFailure = false): Map[keyof Map]['$value'] {
    const singleAliasMatch = typeof value === 'string' && (
      (value as string).trim().match(/^{([^}]+)}$|^\$([^$\s]+)$/)
    )

    if (singleAliasMatch) {
      // replace with resolved value
      const ref = singleAliasMatch[1] || singleAliasMatch[2];
      const path = ref.split(/[\.\/]/).join('.');
      const resolved = get(this.$tokens, path, null) as ITokenGroup<Map, Ext>[string];
      if (resolved && typeof resolved === 'object' && '$value' in resolved) {
        return this.resolveValue(resolved.$value, throwOnFailure);
      }

      if (throwOnFailure) {
        throw new ResolveError(ref);
      }
    }

    if (typeof value === 'string' && /{([^}]+)}$|^\$([^$\s]+)/.test(value)) {
      // interpolated value
      const resolved = this.resolveValue((value as string).replace(
        /{([^}]+)}$|^\$([^$\s]+)/,
        (str: string, p1: string, p2: string) => {
          const path = (p1 || p2).split(/[\.\/]/).join('.');
          const resolved = get(this.$tokens, path, null) as ITokenGroup<Map, Ext>[string];
          if (resolved && typeof resolved === 'object' && '$value' in resolved) {
            return this.resolveValue(resolved.$value);
          }

          if (throwOnFailure) {
            throw new ResolveError(p1 || p2);
          }

          return '';
        }
      ), throwOnFailure);
      return resolved;
    }

    if (value && typeof value === 'object') {
      const entries = Object.entries(value);
      return Object.fromEntries(entries.map(([key, subvalue]) => {
        if (subvalue) {
          return [key, this.resolveValue(subvalue, throwOnFailure)] as [string, typeof subvalue];
        }

        return [key, subvalue] as [string, typeof subvalue];
      }));
    }

    // can't resolve other values (ie numeric, boolean, ...)
    return value;
  }

  public resolve(token: [string, Map[keyof Map]], throwOnFailure = false) {
    const tokenChain = compact(token[0].split(/[\.\/]/))
    const tokenChainObject = tokenChain.reduce<ITokenGroup<Map, Ext>>((obj, key, index) => {
      const path = tokenChain.slice(0, index).join('.');
      const incomingObject = pick(get(this.$tokens, path, {}), '$type', '$description', '$extensions');
      return extend(obj, incomingObject) as ITokenGroup<Map, Ext>;
    }, {});
    const tokenObject = extend(tokenChainObject, token[1]) as Map[keyof Map];
    const resolvedValue = this.resolveValue(tokenObject.$value);
    if (tokenObject.$type && this.$validators[tokenObject.$type]) {
      const validationResult = this.$validators[tokenObject.$type]!.safeParse(resolvedValue);
      if (validationResult.success) {
        tokenObject.$value = validationResult.data;
      } else if (throwOnFailure) {
        throw new ResolveError(token[0])
      } else {
        tokenObject.$value = token[1].$value;
      }
    } else {
      tokenObject.$value = resolvedValue;
    }
    return tokenObject;
  }

  public mutate(fn: (input: TokenOrGroup<Map, Ext>) => void | null | TokenOrGroup<Map, Ext>) {
    const mutations: [string, TokenOrGroup<Map, Ext> | null][] = [];

    traverse(this.$tokens, {
      allKeys: true,
      cb: (object, jsonPtr, rootSchema) => {
        // @README ignore the root object traversal
        if (jsonPtr !== '') {
          const path = compact(jsonPtr.split('/')).join('.');
          const validationResult = tokenSchema.safeParse(object);
          if (validationResult.success) {
            const result = fn(validationResult.data as TokenOrGroup<Map, Ext>)
            if (result || result === null) mutations.push([path, result])
          } else {
            const groupValidationResult = tokenGroupObjectSchema.and(tokenGroupChildrenSchema).safeParse(object);
            if (groupValidationResult.success) {
              const result = fn(pick(groupValidationResult.data, '$type', '$value', '$description'))
              if (result || result === null) mutations.push([path, result])
            }
          }
        }
      }
    });

    mutations.forEach(([path, tokenOrGroup]) => {
      if(tokenOrGroup) {
        set(this.$tokens, path, extend({}, tokenOrGroup));
      } else if (tokenOrGroup === null) {
        const chain = path.split('.')
        if (chain.length === 1) {
          delete this.$tokens[chain[0]];
          this.$tokens = extend({}, this.$tokens) as ITokenGroup<Map, Ext>;
        } else {
          const parentPath = chain.slice(0, -1).join('.')
          const parentObject = get(this.$tokens, parentPath, null);
          if (parentObject) {
            const mutated = extend({}, parentObject)
            delete mutated[chain[chain.length - 1]];
            set(this.$tokens, parentPath, parentObject);
          }
        }
      }
    });

    this.$subscribers.forEach((fn) => fn(mutations, this.$tokens));
  }

  public subscribe(fn: (mutations: [string, TokenOrGroup<Map, Ext> | null][], $tokens: ITokenGroup<Map, Ext>) => void) {
    this.$subscribers.push(fn);
    return () => {
      const indexOf = this.$subscribers.indexOf(fn);
      if (indexOf > -1) this.$subscribers.splice(indexOf, 1);
    };
  }

  public flatmap() {
    const flatmap: Record<string, TokenOrGroup<Map, Ext>> = {};

    traverse(this.$tokens, {
      allKeys: true,
      cb: (object, jsonPtr, rootSchema) => {
        // @README ignore the root object traversal
        if (jsonPtr !== '') {
          const validationResult = tokenSchema.safeParse(object);
          if (validationResult.success) {
            flatmap[jsonPtr] = validationResult.data as TokenOrGroup<Map, Ext>;
          } else {
            const groupValidationResult = tokenGroupObjectSchema.and(tokenGroupChildrenSchema).safeParse(object);
            if (groupValidationResult.success) {
              flatmap[jsonPtr] = pick(groupValidationResult.data, '$type', '$value', '$description');
            }
          }
        }
      }
    });

    return flatmap;
  }
}