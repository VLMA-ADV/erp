-- Cadastro de fornecedor destravado (pedido 21/07): só o nome é obrigatório.
-- O unique (tenant_id, cpf_cnpj) segue valendo para quem informa o documento
-- (NULLs não colidem).
ALTER TABLE operations.fornecedores ALTER COLUMN cpf_cnpj DROP NOT NULL;
