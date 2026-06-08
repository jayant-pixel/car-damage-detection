declare module "jpeg-js" {
  export function decode(buffer: Uint8Array, options?: { useTArray?: boolean; maxMemoryUsageInMB?: number }): {
    width: number;
    height: number;
    data: Uint8Array;
  };

  export function encode(rawImageData: { data: Uint8Array; width: number; height: number }, quality?: number): {
    data: Uint8Array;
    width: number;
    height: number;
  };
}
