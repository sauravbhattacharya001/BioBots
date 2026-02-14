# escape=`

# BioBots Tool - .NET Framework 4.5.2 ASP.NET Web API
# Requires Windows containers (not Linux)

# ---- Build Stage ----
FROM mcr.microsoft.com/dotnet/framework/sdk:4.8-windowsservercore-ltsc2022 AS build
WORKDIR /src

# Copy solution and NuGet config first for better layer caching
COPY BioBotsTool.sln .
COPY Try/packages.config Try/packages.config

# Restore NuGet packages
RUN nuget restore BioBotsTool.sln

# Copy everything else
COPY . .

# Build in Release mode
RUN msbuild BioBotsTool.sln /p:Configuration=Release /p:Platform="Any CPU" /p:DeployOnBuild=true /p:PublishUrl=/app /m /verbosity:minimal

# ---- Runtime Stage ----
FROM mcr.microsoft.com/dotnet/framework/aspnet:4.8-windowsservercore-ltsc2022 AS runtime
WORKDIR /inetpub/wwwroot

# Copy published output
COPY --from=build /app .

# Copy the bioprint data file
COPY bioprint-data.json .

# Expose IIS default port
EXPOSE 80

# IIS is the entrypoint by default in the aspnet image
