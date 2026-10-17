"""Pure-NumPy stand-in for numba, used only where numba is unavailable (IBM Z / s390x).

librosa imports numba unconditionally, but numba has no s390x support. This module provides the
small subset of the numba API librosa uses (jit, vectorize, guvectorize, stencil) by running the
decorated functions as ordinary Python/NumPy code. Results are identical; only speed differs.
It is installed as the top-level ``numba`` package in the s390x ML image only.
"""
import ast
import hashlib
import inspect
import textwrap

import numpy as np

__version__ = "0.0.0+numpy-shim"

# Scalar type attributes referenced as numba.<type> (e.g. numba.uint32 used as a dtype)
bool_ = np.bool_
int8, int16, int32, int64 = np.int8, np.int16, np.int32, np.int64
uint8, uint16, uint32, uint64 = np.uint8, np.uint16, np.uint32, np.uint64
float32, float64 = np.float32, np.float64
complex64, complex128 = np.complex64, np.complex128

_NP_TYPES = {
    "bool_": np.bool_, "boolean": np.bool_, "b1": np.bool_,
    "int8": np.int8, "int16": np.int16, "int32": np.int32, "int64": np.int64,
    "uint8": np.uint8, "uint16": np.uint16, "uint32": np.uint32, "uint64": np.uint64,
    "float32": np.float32, "float64": np.float64,
    "complex64": np.complex64, "complex128": np.complex128,
}


def _decorator(make):
    """Support both ``@deco`` and ``@deco(...)`` forms."""
    def deco(*args, **kwargs):
        if len(args) == 1 and callable(args[0]) and not kwargs:
            return make(args[0], (), {})
        return lambda func: make(func, args, kwargs)
    return deco


# ---------------------------------------------------------------- jit / njit
jit = njit = generated_jit = _decorator(lambda func, args, kwargs: func)
prange = range


# ---------------------------------------------------------------- vectorize
def _parse_signature(sig):
    """'float32(complex64)' / 'void(float32[:], bool_[:])' -> (return type, [arg types])."""
    ret, _, rest = sig.partition("(")
    args = [a.strip().replace("[:]", "") for a in rest.rstrip(")").split(",") if a.strip()]
    return ret.strip(), args


class _Vectorized:
    def __init__(self, func, signatures):
        self.func = func
        self.signatures = [_parse_signature(s) for s in (signatures or []) if isinstance(s, str)]
        self.__name__ = getattr(func, "__name__", "vectorized")
        self.__doc__ = func.__doc__

    def _otype(self, args):
        for ret, sig_args in self.signatures:
            if len(sig_args) == len(args) and all(
                np.asarray(a).dtype == _NP_TYPES.get(t) for a, t in zip(args, sig_args)
            ):
                return _NP_TYPES.get(ret)
        return None

    def __call__(self, *args, **kwargs):
        otype = self._otype(args)
        try:
            # Element-wise arithmetic bodies work directly on whole arrays
            out = np.asarray(self.func(*args))
        except (TypeError, ValueError):
            out = np.vectorize(self.func, otypes=[otype] if otype else None)(*args)
        if otype is not None:
            out = out.astype(otype, copy=False)
        if "out" in kwargs and kwargs["out"] is not None:
            kwargs["out"][...] = out
            return kwargs["out"]
        return out if out.ndim else out[()]


vectorize = _decorator(lambda func, args, kwargs: _Vectorized(func, args[0] if args else kwargs.get("signatures")))


# ---------------------------------------------------------------- stencil
def _relative_indices(func):
    """Statically find the constant relative offsets a stencil kernel reads from its first argument."""
    tree = ast.parse(textwrap.dedent(inspect.getsource(func)))
    fdef = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef))
    name = fdef.args.args[0].arg
    offsets = []
    for node in ast.walk(fdef):
        if isinstance(node, ast.Subscript) and isinstance(node.value, ast.Name) and node.value.id == name:
            offsets.append(int(ast.literal_eval(node.slice)))
    if not offsets:
        raise ValueError(f"stencil {func.__name__}: no relative indices found")
    return min(offsets), max(offsets)


class _Shifted:
    """Relative-index view: x[k] -> the array shifted by k over the stencil interior."""
    __slots__ = ("a", "start", "stop")

    def __init__(self, a, start, stop):
        self.a, self.start, self.stop = a, start, stop

    def __getitem__(self, k):
        return self.a[self.start + k:self.stop + k]


class _Point:
    """Relative-index view centred on a single element (fallback for kernels with branches)."""
    __slots__ = ("a", "i")

    def __init__(self, a, i):
        self.a, self.i = a, i

    def __getitem__(self, k):
        return self.a[self.i + k]


def _pi_interior(x, start, stop):
    """librosa.core.pitch._pi_stencil, vectorized with numba's type promotion
    (float32 sums, promoted to float64 when combined with the int literal 2)."""
    xm, x0, xp = x[start - 1:stop - 1], x[start:stop], x[start + 1:stop + 1]
    a = (xp + xm).astype(np.float64) - 2 * x0.astype(np.float64)
    b = (xp - xm).astype(np.float64) / 2
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(np.abs(b) >= np.abs(a), 0.0, -b / a)


def _zc_interior(x, start, stop, threshold, zero_pos):
    """librosa.core.audio._zc_stencil, vectorized."""
    x0, x1 = x[start:stop], x[start - 1:stop - 1]
    x0 = np.where((-threshold <= x0) & (x0 <= threshold), 0, x0)
    x1 = np.where((-threshold <= x1) & (x1 <= threshold), 0, x1)
    if zero_pos:
        return np.signbit(x0) != np.signbit(x1)
    return np.sign(x0) != np.sign(x1)


# Vectorized equivalents of librosa kernels that branch on element values (and so cannot run in
# array mode). Keyed by a hash of the kernel source: if librosa changes a kernel, the hash no longer
# matches and the exact (slower) per-element path is used instead.
_FAST_KERNELS = {
    "720277f77020de08": _pi_interior,   # librosa 0.11.0 core/pitch.py _pi_stencil
    "9bf8dbf430d3825b": _zc_interior,   # librosa 0.11.0 core/audio.py _zc_stencil
}


class _Stencil:
    def __init__(self, func):
        self.func = func
        self.lo, self.hi = _relative_indices(func)
        self.__name__ = func.__name__
        src = textwrap.dedent(inspect.getsource(func))
        self.fast = _FAST_KERNELS.get(hashlib.sha256(src.encode()).hexdigest()[:16])

    def __call__(self, x, *args):
        x = np.asarray(x)
        n = x.shape[0]
        start, stop = max(0, -self.lo), n - max(0, self.hi)
        if stop <= start:
            return np.zeros_like(x)
        if self.fast is not None:
            interior = np.asarray(self.fast(x, start, stop, *args))
            out = np.zeros(n, dtype=interior.dtype)
            out[start:stop] = interior
            return out
        try:
            interior = np.asarray(self.func(_Shifted(x, start, stop), *args))
            if interior.shape != (stop - start,):
                raise ValueError("kernel is not element-wise")
        except (ValueError, TypeError):
            # Kernel branches on element values: evaluate one element at a time
            interior = np.array([self.func(_Point(x, i), *args) for i in range(start, stop)])
        out = np.zeros(n, dtype=interior.dtype)  # numba's default border value (cval) is 0
        out[start:stop] = interior
        return out


stencil = _decorator(lambda func, args, kwargs: _Stencil(func))


# ---------------------------------------------------------------- guvectorize
def _parse_layout(layout):
    """'(n),(),()->(n)' -> ([('n',), (), ()], [('n',)])"""
    def parse(part):
        groups = []
        for g in part.split(")"):
            g = g.strip(", (")
            groups.append(tuple(d.strip() for d in g.split(",") if d.strip()))
        return groups[: part.count(")")]
    ins, outs = layout.replace(" ", "").split("->")
    return parse(ins), parse(outs)


class _GUVectorized:
    def __init__(self, func, signatures, layout):
        self.func = func
        self.signatures = [_parse_signature(s) for s in signatures if isinstance(s, str)]
        self.in_dims, self.out_dims = _parse_layout(layout)
        self.__name__ = func.__name__

    def _out_dtypes(self, inputs):
        n_in = len(self.in_dims)
        for _, sig_args in self.signatures:
            if all(np.asarray(a).dtype == _NP_TYPES.get(t) for a, t in zip(inputs, sig_args[:n_in])):
                return [_NP_TYPES.get(t, np.float64) for t in sig_args[n_in:]]
        _, sig_args = self.signatures[0]
        return [_NP_TYPES.get(t, np.float64) for t in sig_args[n_in:]]

    def __call__(self, *args, **kwargs):
        n_in = len(self.in_dims)
        inputs = [np.asarray(a) for a in args[:n_in]]
        outputs = list(args[n_in:]) or kwargs.get("out") or None

        # Split each input into loop (broadcast) dims and core dims
        sizes, loop_shapes = {}, []
        for arr, dims in zip(inputs, self.in_dims):
            core = arr.shape[arr.ndim - len(dims):] if dims else ()
            sizes.update(zip(dims, core))
            loop_shapes.append(arr.shape[: arr.ndim - len(dims)])
        loop_shape = np.broadcast_shapes(*loop_shapes)
        inputs = [
            np.broadcast_to(arr, loop_shape + arr.shape[arr.ndim - len(dims):])
            for arr, dims in zip(inputs, self.in_dims)
        ]

        if outputs is None:
            outputs = [
                np.zeros(loop_shape + tuple(sizes[d] for d in dims), dtype=dt)
                for dims, dt in zip(self.out_dims, self._out_dtypes(inputs))
            ]
        elif not isinstance(outputs, (list, tuple)):
            outputs = [outputs]

        for idx in np.ndindex(*loop_shape):
            ins = [a[idx] if dims else a[idx][()] for a, dims in zip(inputs, self.in_dims)]
            self.func(*ins, *[o[idx] for o in outputs])

        return outputs[0] if len(outputs) == 1 else tuple(outputs)


guvectorize = _decorator(lambda func, args, kwargs: _GUVectorized(
    func, args[0] if args else kwargs["signatures"], args[1] if len(args) > 1 else kwargs["layout"]
))
