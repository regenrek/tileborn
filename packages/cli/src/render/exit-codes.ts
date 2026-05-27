/** Process exit codes aligned with sysexits.h where practical. */
export const ExitCode = {
  Ok: 0,
  Generic: 1,
  Usage: 64,
  DataErr: 65,
  NoInput: 66,
  Unavailable: 69,
  Software: 70,
  OsErr: 71,
  IoErr: 74,
  TempFail: 75,
  Config: 78,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

export const exitCodeLabel = (code: ExitCodeValue): string => {
  switch (code) {
    case ExitCode.Ok:
      return "OK";
    case ExitCode.Usage:
      return "USAGE";
    case ExitCode.DataErr:
      return "DATAERR";
    case ExitCode.NoInput:
      return "NOINPUT";
    case ExitCode.Unavailable:
      return "UNAVAILABLE";
    case ExitCode.IoErr:
      return "IOERR";
    case ExitCode.TempFail:
      return "TEMPFAIL";
    case ExitCode.Config:
      return "CONFIG";
    default:
      return "ERROR";
  }
};
