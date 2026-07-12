import { isAuthApiError, isAuthWeakPasswordError, type AuthError } from "@supabase/supabase-js";

/** Translates the Supabase Auth error messages we actually see in this app to pt-BR. */
export function translateAuthError(error: AuthError): string {
  if (isAuthWeakPasswordError(error)) {
    return "Senha muito fraca. Use ao menos 8 caracteres, com letras e números.";
  }

  if (isAuthApiError(error)) {
    switch (error.code) {
      case "invalid_credentials":
        return "E-mail ou senha inválidos.";
      case "email_not_confirmed":
        return "Confirme seu e-mail antes de entrar.";
      case "user_already_exists":
      case "email_exists":
        return "Já existe uma conta com esse e-mail.";
      case "over_email_send_rate_limit":
        return "Muitas tentativas. Aguarde um momento e tente novamente.";
      case "same_password":
        return "A nova senha precisa ser diferente da atual.";
    }
  }

  return "Não foi possível concluir. Tente novamente em instantes.";
}
