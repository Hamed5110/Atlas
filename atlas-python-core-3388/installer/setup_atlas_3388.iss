#define AppName "ATLAS Python Core 3388"
#define AppVersion "0.3.0"
#define AppPublisher "ATLAS"
#define AppExeName "atlas-python-core-3388.exe"

[Setup]
AppId={{8A5C66C5-BC27-4C51-AB2C-338800030000}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName=C:\Atlas3388
DisableDirPage=no
DefaultGroupName=ATLAS Python Core 3388
OutputDir=..\dist
OutputBaseFilename=Setup_AtlasPythonCore3388_v0.3.0
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
UninstallDisplayIcon={app}\atlas-python-core-3388.exe
SetupLogging=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "..\dist\atlas-python-core-3388\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\ATLAS Python Core 3388"; Filename: "http://127.0.0.1:{code:GetAppPort}"
Name: "{commondesktop}\ATLAS Python Core 3388"; Filename: "http://127.0.0.1:{code:GetAppPort}"; Tasks: desktopicon
Name: "{group}\API Documentation"; Filename: "http://127.0.0.1:{code:GetAppPort}/docs"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"

[Run]
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\scripts\install_atlas_3388.ps1"" -SourceRoot ""{app}"" -InstallRoot ""{app}"" -DbServer ""{code:GetSqlHost}"" -DbPort ""{code:GetSqlPort}"" -DbName ""{code:GetDbName}"" -DbUser ""{code:GetDbUser}"" -DbPassword ""{code:GetDbPassword}"""; Flags: waituntilterminated; StatusMsg: "Configuring ATLAS Python Core 3388, database, firewall, and Windows service..."

[Code]
var
  DbPage: TInputQueryWizardPage;

function ReadToken(Raw: String; StartAt: Integer): String;
var
  Index: Integer;
begin
  Result := '';
  for Index := StartAt to Length(Raw) do
  begin
    if Raw[Index] = ' ' then
      Exit;
    Result := Result + Raw[Index];
  end;
end;

function CmdParamValue(Name: String; DefaultValue: String): String;
var
  Raw: String;
  RawUpper: String;
  Prefix: String;
  Position: Integer;
begin
  Result := DefaultValue;
  Raw := GetCmdTail;
  StringChangeEx(Raw, '"', '', True);
  StringChangeEx(Raw, '''', '', True);
  StringChangeEx(Raw, #9, ' ', True);
  StringChangeEx(Raw, #13, ' ', True);
  StringChangeEx(Raw, #10, ' ', True);
  RawUpper := Uppercase(Raw);
  Prefix := '/' + Uppercase(Name) + '=';
  Position := Pos(Prefix, RawUpper);
  if Position > 0 then
    Result := ReadToken(Raw, Position + Length(Prefix));
end;

function IsNumericText(Value: String): Boolean;
var
  Index: Integer;
begin
  Result := Length(Value) > 0;
  for Index := 1 to Length(Value) do
  begin
    if (Value[Index] < '0') or (Value[Index] > '9') then
      Result := False;
  end;
end;

function JsonEscape(Value: String): String;
begin
  Result := Value;
  StringChangeEx(Result, '\', '\\', True);
  StringChangeEx(Result, '"', '\"', True);
end;

function GetSqlHost(Param: String): String;
begin
  Result := Trim(DbPage.Values[0]);
end;

function GetSqlPort(Param: String): String;
begin
  Result := Trim(DbPage.Values[1]);
end;

function GetDbName(Param: String): String;
begin
  Result := Trim(DbPage.Values[2]);
end;

function GetDbUser(Param: String): String;
begin
  Result := Trim(DbPage.Values[3]);
end;

function GetDbPassword(Param: String): String;
begin
  Result := Trim(DbPage.Values[4]);
end;

function GetAppPort(Param: String): String;
begin
  Result := Trim(DbPage.Values[5]);
end;

procedure InitializeWizard;
begin
  DbPage := CreateInputQueryPage(
    wpSelectDir,
    'Database and Service Configuration',
    'Configure the isolated ATLAS Python Core 3388 service.',
    'Enter the SQL Server connection details. Custom SQL ports are supported using Server=host,port.'
  );
  DbPage.Add('SQL Server Host:', False);
  DbPage.Add('SQL Custom Port:', False);
  DbPage.Add('Database Name:', False);
  DbPage.Add('DB Username:', False);
  DbPage.Add('DB Password:', True);
  DbPage.Add('Application Service Port:', False);

  DbPage.Values[0] := CmdParamValue('SQLHOST', 'localhost');
  DbPage.Values[1] := CmdParamValue('SQLPORT', '1433');
  DbPage.Values[2] := CmdParamValue('DBNAME', 'AtlasPythonCore3388');
  DbPage.Values[3] := CmdParamValue('DBUSER', 'sa');
  DbPage.Values[4] := CmdParamValue('DBPASSWORD', 'Atlas@25');
  DbPage.Values[5] := CmdParamValue('APPPORT', '3388');
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = DbPage.ID then
  begin
    if Trim(DbPage.Values[0]) = '' then begin MsgBox('SQL Server Host is required.', mbError, MB_OK); Result := False; Exit; end;
    if not IsNumericText(Trim(DbPage.Values[1])) then begin MsgBox('SQL Custom Port must be numeric.', mbError, MB_OK); Result := False; Exit; end;
    if Trim(DbPage.Values[2]) = '' then begin MsgBox('Database Name is required.', mbError, MB_OK); Result := False; Exit; end;
    if Trim(DbPage.Values[3]) = '' then begin MsgBox('DB Username is required.', mbError, MB_OK); Result := False; Exit; end;
    if Trim(DbPage.Values[4]) = '' then begin MsgBox('DB Password is required.', mbError, MB_OK); Result := False; Exit; end;
    if Trim(DbPage.Values[5]) <> '3388' then begin MsgBox('This clean-room installer is locked to application port 3388.', mbError, MB_OK); Result := False; Exit; end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ConfigDir: String;
  Json: String;
begin
  if CurStep = ssPostInstall then
  begin
    ConfigDir := ExpandConstant('{app}\config');
    ForceDirectories(ConfigDir);
    Json :=
      '{' + #13#10 +
      '  "sqlServerHost": "' + JsonEscape(GetSqlHost('')) + '",' + #13#10 +
      '  "sqlCustomPort": "' + JsonEscape(GetSqlPort('')) + '",' + #13#10 +
      '  "databaseName": "' + JsonEscape(GetDbName('')) + '",' + #13#10 +
      '  "dbUsername": "' + JsonEscape(GetDbUser('')) + '",' + #13#10 +
      '  "odbcConnectionString": "Driver={ODBC Driver 17 for SQL Server};Server=' + JsonEscape(GetSqlHost('')) + ',' + JsonEscape(GetSqlPort('')) + ';Database=' + JsonEscape(GetDbName('')) + ';Uid=' + JsonEscape(GetDbUser('')) + ';Pwd=***;Encrypt=yes;TrustServerCertificate=yes;",' + #13#10 +
      '  "applicationPort": "' + JsonEscape(GetAppPort('')) + '"' + #13#10 +
      '}';
    SaveStringToFile(ConfigDir + '\env.json', Json, False);
  end;
end;

