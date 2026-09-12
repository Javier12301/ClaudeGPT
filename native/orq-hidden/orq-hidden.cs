// orq-hidden: launcher Win32 sin consola para los hooks/statusline de orq en
// Windows. Ver docs/DECISIONS.md D-034 para el porque.
//
// Arquitectura: Claude Code/Codex spawnean este .exe (compilado /target:winexe,
// subsistema GUI -> Windows nunca le crea consola, sin importar como lo spawneen).
// Este launcher llama CreateProcessW con CREATE_NO_WINDOW para el proceso real
// (node.exe) y le pasa los MISMOS handles de stdin/stdout/stderr que el host le
// dio a el, duplicados como heredables. Cero relay: no lee ni copia bytes, solo
// reenvia los handles del sistema operativo. Eso evita el deadlock de pipe y los
// problemas de encoding que tendria un wrapper de script que si tuviera que
// bombear stdio a mano.
//
// Uso: orq-hidden.exe <exe-a-lanzar> <arg1> <arg2> ...
// El primer argumento es la ruta absoluta al ejecutable real (ej. node.exe);
// el resto son sus argumentos. Se propaga el exit code exacto del hijo.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

internal static class Program
{
    private const int STD_INPUT_HANDLE = -10;
    private const int STD_OUTPUT_HANDLE = -11;
    private const int STD_ERROR_HANDLE = -12;
    private const uint STARTF_USESTDHANDLES = 0x00000100;
    private const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
    private const uint CREATE_NO_WINDOW = 0x08000000;
    private const uint DUPLICATE_SAME_ACCESS = 0x00000002;
    private const uint INFINITE = 0xFFFFFFFF;
    // ProcThreadAttributeValue(ProcThreadAttributeHandleList=2, Thread=FALSE, Input=TRUE, Additive=FALSE)
    // = 2 | PROC_THREAD_ATTRIBUTE_INPUT(0x00020000) = 0x00020002. Constante documentada
    // de Microsoft para restringir la herencia de handles a una lista explicita.
    private static readonly IntPtr PROC_THREAD_ATTRIBUTE_HANDLE_LIST = new IntPtr(0x00020002);

    [StructLayout(LayoutKind.Sequential)]
    private struct STARTUPINFO
    {
        public int cb;
        public IntPtr lpReserved;
        public IntPtr lpDesktop;
        public IntPtr lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct STARTUPINFOEX
    {
        public STARTUPINFO StartupInfo;
        public IntPtr lpAttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(int nStdHandle);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool DuplicateHandle(
        IntPtr hSourceProcessHandle, IntPtr hSourceHandle,
        IntPtr hTargetProcessHandle, out IntPtr lpTargetHandle,
        uint dwDesiredAccess, [MarshalAs(UnmanagedType.Bool)] bool bInheritHandle, uint dwOptions);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool InitializeProcThreadAttributeList(
        IntPtr lpAttributeList, int dwAttributeCount, int dwFlags, ref IntPtr lpSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool UpdateProcThreadAttribute(
        IntPtr lpAttributeList, uint dwFlags, IntPtr Attribute,
        IntPtr lpValue, IntPtr cbSize, IntPtr lpPreviousValue, IntPtr lpReturnSize);

    [DllImport("kernel32.dll")]
    private static extern void DeleteProcThreadAttributeList(IntPtr lpAttributeList);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcessW(
        string lpApplicationName, StringBuilder lpCommandLine,
        IntPtr lpProcessAttributes, IntPtr lpThreadAttributes,
        [MarshalAs(UnmanagedType.Bool)] bool bInheritHandles, uint dwCreationFlags,
        IntPtr lpEnvironment, string lpCurrentDirectory,
        ref STARTUPINFOEX lpStartupInfo, out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll")]
    private static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

    private static int Main(string[] args)
    {
        if (args.Length < 1)
        {
            Console.Error.WriteLine("orq-hidden: falta el ejecutable a lanzar.");
            return 1;
        }

        string appPath = args[0];
        StringBuilder commandLine = new StringBuilder(BuildCommandLine(args));

        // Los handles que el host (Claude Code/Codex) ya nos paso. No asumimos que
        // ya son heredables: se duplican con bInheritHandle=true para garantizarlo
        // sin importar como el host haya creado sus pipes.
        IntPtr hIn = DuplicateStd(STD_INPUT_HANDLE);
        IntPtr hOut = DuplicateStd(STD_OUTPUT_HANDLE);
        IntPtr hErr = DuplicateStd(STD_ERROR_HANDLE);
        List<IntPtr> validHandles = new List<IntPtr>();
        if (hIn != IntPtr.Zero) validHandles.Add(hIn);
        if (hOut != IntPtr.Zero) validHandles.Add(hOut);
        if (hErr != IntPtr.Zero) validHandles.Add(hErr);

        IntPtr attributeList = IntPtr.Zero;
        IntPtr handleArray = IntPtr.Zero;
        IntPtr hProcess = IntPtr.Zero;
        IntPtr hThread = IntPtr.Zero;
        int exitCode = 1;
        try
        {
            IntPtr size = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
            attributeList = Marshal.AllocHGlobal(size);
            if (!InitializeProcThreadAttributeList(attributeList, 1, 0, ref size))
            {
                Console.Error.WriteLine("orq-hidden: InitializeProcThreadAttributeList fallo, error " + Marshal.GetLastWin32Error());
                return 1;
            }

            if (validHandles.Count > 0)
            {
                handleArray = Marshal.AllocHGlobal(IntPtr.Size * validHandles.Count);
                for (int i = 0; i < validHandles.Count; i++)
                    Marshal.WriteIntPtr(handleArray, i * IntPtr.Size, validHandles[i]);

                if (!UpdateProcThreadAttribute(attributeList, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                        handleArray, new IntPtr(IntPtr.Size * validHandles.Count), IntPtr.Zero, IntPtr.Zero))
                {
                    Console.Error.WriteLine("orq-hidden: UpdateProcThreadAttribute fallo, error " + Marshal.GetLastWin32Error());
                    return 1;
                }
            }

            STARTUPINFOEX sui = new STARTUPINFOEX();
            sui.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
            sui.StartupInfo.dwFlags = (int)STARTF_USESTDHANDLES;
            sui.StartupInfo.hStdInput = hIn;
            sui.StartupInfo.hStdOutput = hOut;
            sui.StartupInfo.hStdError = hErr;
            sui.lpAttributeList = attributeList;

            PROCESS_INFORMATION pi;
            bool ok = CreateProcessW(
                appPath, commandLine,
                IntPtr.Zero, IntPtr.Zero,
                true,
                CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT,
                IntPtr.Zero, null,
                ref sui, out pi);

            if (!ok)
            {
                Console.Error.WriteLine("orq-hidden: CreateProcessW fallo, error " + Marshal.GetLastWin32Error());
                return 1;
            }
            hProcess = pi.hProcess;
            hThread = pi.hThread;

            WaitForSingleObject(hProcess, INFINITE);
            uint code;
            GetExitCodeProcess(hProcess, out code);
            exitCode = unchecked((int)code);
        }
        finally
        {
            foreach (IntPtr h in validHandles) CloseHandle(h);
            if (hThread != IntPtr.Zero) CloseHandle(hThread);
            if (hProcess != IntPtr.Zero) CloseHandle(hProcess);
            if (attributeList != IntPtr.Zero)
            {
                DeleteProcThreadAttributeList(attributeList);
                Marshal.FreeHGlobal(attributeList);
            }
            if (handleArray != IntPtr.Zero) Marshal.FreeHGlobal(handleArray);
        }
        return exitCode;
    }

    // Duplica un std handle del proceso actual como heredable. Devuelve
    // IntPtr.Zero si el stream no existe (host no lo redirigio) o la
    // duplicacion falla: ese stream simplemente se omite mas adelante.
    private static IntPtr DuplicateStd(int stdHandleId)
    {
        IntPtr h = GetStdHandle(stdHandleId);
        if (h == IntPtr.Zero || h == new IntPtr(-1)) return IntPtr.Zero;
        IntPtr cur = GetCurrentProcess();
        IntPtr dup;
        if (!DuplicateHandle(cur, h, cur, out dup, 0, true, DUPLICATE_SAME_ACCESS)) return IntPtr.Zero;
        return dup;
    }

    private static string BuildCommandLine(string[] args)
    {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < args.Length; i++)
        {
            if (i > 0) sb.Append(' ');
            AppendQuotedArg(sb, args[i]);
        }
        return sb.ToString();
    }

    // Algoritmo estandar de Microsoft para citar argumentos de linea de comando
    // de forma compatible con como CommandLineToArgvW los vuelve a separar
    // (backslashes solo se escapan cuando preceden una comilla o van al final
    // de un argumento citado).
    private static void AppendQuotedArg(StringBuilder sb, string arg)
    {
        if (arg.Length != 0 && arg.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0)
        {
            sb.Append(arg);
            return;
        }
        sb.Append('"');
        int i = 0;
        while (true)
        {
            int backslashes = 0;
            while (i < arg.Length && arg[i] == '\\') { i++; backslashes++; }
            if (i == arg.Length)
            {
                sb.Append('\\', backslashes * 2);
                break;
            }
            else if (arg[i] == '"')
            {
                sb.Append('\\', backslashes * 2 + 1);
                sb.Append(arg[i]);
            }
            else
            {
                sb.Append('\\', backslashes);
                sb.Append(arg[i]);
            }
            i++;
        }
        sb.Append('"');
    }
}
