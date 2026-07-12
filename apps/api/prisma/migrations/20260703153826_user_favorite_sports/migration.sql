-- Editar Perfil screen (design update) adds an "Esportes favoritos" chip
-- picker — plain text tags, no separate sports table needed for this.
ALTER TABLE "users" ADD COLUMN "favorite_sports" TEXT[] NOT NULL DEFAULT '{}';
