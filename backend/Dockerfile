# syntax=docker/dockerfile:1.7
# ---------- build ----------
FROM mcr.microsoft.com/dotnet/sdk:11.0-alpine AS build
WORKDIR /src
COPY global.json Directory.Build.props Directory.Packages.props .editorconfig ./
COPY src/Tesorero.Domain/Tesorero.Domain.csproj src/Tesorero.Domain/
COPY src/Tesorero.Application/Tesorero.Application.csproj src/Tesorero.Application/
COPY src/Tesorero.Infrastructure/Tesorero.Infrastructure.csproj src/Tesorero.Infrastructure/
COPY src/Tesorero.Api/Tesorero.Api.csproj src/Tesorero.Api/
RUN dotnet restore src/Tesorero.Api/Tesorero.Api.csproj
COPY src/ src/
ARG APP_VERSION=dev
RUN dotnet publish src/Tesorero.Api/Tesorero.Api.csproj -c Release -o /app --no-restore \
    -p:InformationalVersion=${APP_VERSION} -p:UseAppHost=false

# ---------- runtime ----------
FROM mcr.microsoft.com/dotnet/aspnet:11.0-alpine AS runtime
RUN apk add --no-cache curl
WORKDIR /app
COPY --from=build /app .
ENV ASPNETCORE_HTTP_PORTS=8080 \
    DOTNET_RUNNING_IN_CONTAINER=true \
    DOTNET_gcServer=0
EXPOSE 8080
USER $APP_UID
HEALTHCHECK --interval=15s --timeout=5s --retries=10 --start-period=40s CMD curl -fsS http://localhost:8080/health || exit 1
ENTRYPOINT ["dotnet", "Tesorero.Api.dll"]
