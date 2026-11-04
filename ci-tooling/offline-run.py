#!/usr/bin/env python3
"""Linux AMD64 test launcher: kernel-enforced denial of network socket syscalls."""
import ctypes
import os
import subprocess
import sys

if len(sys.argv) < 2:
    raise SystemExit('usage: offline-run.py COMMAND [ARGS...]')
if os.uname().machine != 'x86_64':
    raise SystemExit('seccomp profile only verified for Linux AMD64')


class Filter(ctypes.Structure):
    _fields_ = [('code', ctypes.c_ushort), ('jt', ctypes.c_ubyte),
                ('jf', ctypes.c_ubyte), ('k', ctypes.c_uint)]


class Program(ctypes.Structure):
    _fields_ = [('length', ctypes.c_ushort), ('filter', ctypes.POINTER(Filter))]


def restrict():
    # Validate architecture, reject x32 ABI, deny network-capable socket creation/I/O.
    instructions = [(0x20, 0, 0, 4), (0x15, 1, 0, 0xC000003E),
                    (0x06, 0, 0, 0x80000000), (0x20, 0, 0, 0),
                    (0x35, 0, 1, 0x40000000), (0x06, 0, 0, 0x80000000)]
    for syscall in [41, 42, 44, 46, 53]:
        instructions += [(0x15, 0, 1, syscall), (0x06, 0, 0, 0x00050001)]
    instructions += [(0x06, 0, 0, 0x7FFF0000)]
    filters = (Filter * len(instructions))(*[Filter(*x) for x in instructions])
    program = Program(len(filters), filters)
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(38, 1, 0, 0, 0) != 0 or libc.prctl(22, 2, ctypes.byref(program)) != 0:
        os._exit(125)


result = subprocess.run(sys.argv[1:], preexec_fn=restrict, close_fds=True)
raise SystemExit(result.returncode)
