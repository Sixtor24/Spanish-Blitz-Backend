#!/bin/bash

# Spanish Blitz Backend - Setup Verification Script

echo "🔍 Verificando configuración del backend..."
echo ""

ERRORS=0
WARNINGS=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check Node.js version
echo "📦 Verificando Node.js..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    echo -e "${GREEN}✓${NC} Node.js instalado: $NODE_VERSION"
    
    # Check if version is >= 20
    MAJOR_VERSION=$(echo $NODE_VERSION | cut -d. -f1 | sed 's/v//')
    if [ "$MAJOR_VERSION" -lt 20 ]; then
        echo -e "${RED}✗${NC} Node.js versión 20 o superior requerida"
        ERRORS=$((ERRORS + 1))
    fi
else
    echo -e "${RED}✗${NC} Node.js no encontrado"
    ERRORS=$((ERRORS + 1))
fi

# Check .env file
echo ""
echo "🔐 Verificando archivo .env..."
if [ -f .env ]; then
    echo -e "${GREEN}✓${NC} Archivo .env encontrado"
    
    # Check required variables
    REQUIRED_VARS=("DATABASE_URL" "AUTH_SECRET" "RESEND_API_KEY" "RESEND_FROM_EMAIL")
    for VAR in "${REQUIRED_VARS[@]}"; do
        if grep -q "^$VAR=" .env; then
            VALUE=$(grep "^$VAR=" .env | cut -d'=' -f2-)
            if [ -z "$VALUE" ] || [ "$VALUE" = "your-value-here" ]; then
                echo -e "${YELLOW}⚠${NC} $VAR está vacío o usa valor placeholder"
                WARNINGS=$((WARNINGS + 1))
            else
                echo -e "${GREEN}✓${NC} $VAR configurado"
            fi
        else
            echo -e "${RED}✗${NC} $VAR no encontrado en .env"
            ERRORS=$((ERRORS + 1))
        fi
    done
else
    echo -e "${RED}✗${NC} Archivo .env no encontrado"
    echo "   Copia .env.example a .env y configúralo"
    ERRORS=$((ERRORS + 1))
fi

# Check node_modules
echo ""
echo "📚 Verificando dependencias..."
if [ -d node_modules ]; then
    echo -e "${GREEN}✓${NC} node_modules encontrado"
else
    echo -e "${YELLOW}⚠${NC} node_modules no encontrado"
    echo "   Ejecuta: npm install"
    WARNINGS=$((WARNINGS + 1))
fi

# Check package.json
echo ""
echo "📄 Verificando package.json..."
if [ -f package.json ]; then
    echo -e "${GREEN}✓${NC} package.json encontrado"
    
    # Check if dependencies are listed
    if grep -q "\"dependencies\"" package.json; then
        echo -e "${GREEN}✓${NC} Dependencias definidas"
    else
        echo -e "${RED}✗${NC} No se encontraron dependencias en package.json"
        ERRORS=$((ERRORS + 1))
    fi
else
    echo -e "${RED}✗${NC} package.json no encontrado"
    ERRORS=$((ERRORS + 1))
fi

# Check TypeScript config
echo ""
echo "📘 Verificando TypeScript..."
if [ -f tsconfig.json ]; then
    echo -e "${GREEN}✓${NC} tsconfig.json encontrado"
else
    echo -e "${RED}✗${NC} tsconfig.json no encontrado"
    ERRORS=$((ERRORS + 1))
fi

# Check src directory structure
echo ""
echo "📁 Verificando estructura de carpetas..."
REQUIRED_DIRS=("src" "src/config" "src/middleware" "src/routes" "src/services" "src/types")
for DIR in "${REQUIRED_DIRS[@]}"; do
    if [ -d "$DIR" ]; then
        echo -e "${GREEN}✓${NC} $DIR/"
    else
        echo -e "${RED}✗${NC} $DIR/ no encontrado"
        ERRORS=$((ERRORS + 1))
    fi
done

# Check critical files
echo ""
echo "📝 Verificando archivos críticos..."
CRITICAL_FILES=(
    "src/index.ts"
    "src/config/env.ts"
    "src/config/database.ts"
    "src/config/auth.ts"
    "src/middleware/auth.ts"
    "src/middleware/error.ts"
)
for FILE in "${CRITICAL_FILES[@]}"; do
    if [ -f "$FILE" ]; then
        echo -e "${GREEN}✓${NC} $FILE"
    else
        echo -e "${RED}✗${NC} $FILE no encontrado"
        ERRORS=$((ERRORS + 1))
    fi
done

# Check route files
echo ""
echo "🛣️  Verificando archivos de rutas..."
ROUTE_FILES=(
    "src/routes/health.ts"
    "src/routes/auth.ts"
    "src/routes/users.ts"
    "src/routes/admin.ts"
    "src/routes/decks.ts"
    "src/routes/cards.ts"
    "src/routes/play-sessions.ts"
    "src/routes/stats.ts"
    "src/routes/study-events.ts"
)
for FILE in "${ROUTE_FILES[@]}"; do
    if [ -f "$FILE" ]; then
        echo -e "${GREEN}✓${NC} $FILE"
    else
        echo -e "${RED}✗${NC} $FILE no encontrado"
        ERRORS=$((ERRORS + 1))
    fi
done

# Check documentation
echo ""
echo "📚 Verificando documentación..."
DOC_FILES=("README.md" "MIGRATION_GUIDE.md" "FRONTEND_INTEGRATION.md" "CHECKLIST.md")
for FILE in "${DOC_FILES[@]}"; do
    if [ -f "$FILE" ]; then
        echo -e "${GREEN}✓${NC} $FILE"
    else
        echo -e "${YELLOW}⚠${NC} $FILE no encontrado (recomendado)"
        WARNINGS=$((WARNINGS + 1))
    fi
done

# Test if server can start (optional, requires dependencies)
if [ -d node_modules ]; then
    echo ""
    echo "🚀 Verificando que el servidor puede iniciar..."
    echo "   (Esto puede tomar unos segundos...)"
    
    # Try to run type check
    if npm run typecheck &> /dev/null; then
        echo -e "${GREEN}✓${NC} TypeScript compila sin errores"
    else
        echo -e "${YELLOW}⚠${NC} Hay errores de TypeScript (revísalos con: npm run typecheck)"
        WARNINGS=$((WARNINGS + 1))
    fi
fi

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 RESUMEN"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✓ ¡Todo está configurado correctamente!${NC}"
    echo ""
    echo "Próximos pasos:"
    echo "  1. npm run dev     - Iniciar servidor de desarrollo"
    echo "  2. curl http://localhost:3001/api/health - Probar endpoint"
    echo "  3. Leer FRONTEND_INTEGRATION.md para conectar frontend"
elif [ $ERRORS -eq 0 ]; then
    echo -e "${YELLOW}⚠ Configuración completa con advertencias${NC}"
    echo -e "Advertencias: $WARNINGS"
    echo ""
    echo "Puedes continuar pero revisa las advertencias arriba."
else
    echo -e "${RED}✗ Se encontraron errores críticos${NC}"
    echo -e "Errores: $ERRORS"
    echo -e "Advertencias: $WARNINGS"
    echo ""
    echo "Por favor, corrige los errores antes de continuar."
    exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

