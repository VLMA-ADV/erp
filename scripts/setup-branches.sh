#!/bin/bash

# Script para configurar a estrutura de branches
# Uso: ./scripts/setup-branches.sh

set -e

echo "🌿 Configurando estrutura de branches..."

# Verificar se está na branch main
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo "⚠️  Você não está na branch main. Mudando para main..."
    git checkout main
fi

# Atualizar main
echo "📥 Atualizando branch main..."
git pull origin main

# Verificar se branch dev já existe
if git show-ref --verify --quiet refs/heads/dev; then
    echo "⚠️  Branch dev já existe localmente."
    read -p "Deseja recriar a branch dev? (s/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Ss]$ ]]; then
        git branch -D dev
        git checkout -b dev
    else
        git checkout dev
        git pull origin dev
    fi
else
    # Criar branch dev
    echo "✨ Criando branch dev..."
    git checkout -b dev
fi

# Verificar se dev existe no remoto
if git ls-remote --heads origin dev | grep -q dev; then
    echo "📤 Branch dev já existe no remoto. Fazendo push das atualizações..."
    git push origin dev
else
    echo "📤 Enviando branch dev para o remoto..."
    git push -u origin dev
fi

echo ""
echo "✅ Estrutura de branches configurada com sucesso!"
echo ""
echo "📋 Branches disponíveis:"
git branch -a
echo ""
echo "💡 Próximos passos:"
echo "   1. Configure as proteções de branch no GitHub"
echo "   2. Configure os secrets do GitHub Actions"
echo "   3. Configure os sites no Netlify"
echo ""
echo "📖 Consulte README_BRANCHES.md para mais informações"
