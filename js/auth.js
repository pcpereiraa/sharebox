// 1. LÓGICA DA PÁGINA DE REGISTO

const registerForm = document.getElementById("register-form");

if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const name = document.getElementById("input-name").value;
        const surname = document.getElementById("input-surname").value;
        const email = document.getElementById("input-email").value;
        const pwd = document.getElementById("input-pwd").value;
        const pwd2 = document.getElementById("input-pwd2").value;

        if (pwd !== pwd2) {
            alert("As passwords não batem!");
            return;
        }

        const { data, error } = await supabaseClient.auth.signUp({
            email,
            password: pwd,
            options: {
                data: {
                    full_name: name + " " + surname,
                    username: email
                }
            }
        });

        if (error) {
            alert(error.message);
            return;
        }

        alert("Conta criada com sucesso!");
        window.location.href = "login.html";
    });
}


// 2. LÓGICA DA PÁGINA DE LOGIN 
const loginForm = document.getElementById("login-form");

if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const email = document.getElementById("login-email").value;
        const pwd = document.getElementById("login-pwd").value;

        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email,
            password: pwd
        });

        if (error) {
            alert("Erro ao entrar: " + error.message);
            return;
        }

        alert("Login efetuado com sucesso!");
        window.location.href = "home.html"; 
    });
}

// 3. RECUPERAR PALAVRA-PASSE

const resetLink = document.getElementById("link-reset");

if (resetLink) {
    resetLink.addEventListener("click", async (e) => {
        e.preventDefault();

        const email = document.getElementById("login-email").value;

        if (!email) {
            alert("Por favor, digita primeiro o teu email no campo de login!");
            return;
        }

        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + '/reset-password.html',
        });

        if (error) {
            alert("Erro ao enviar email de recuperação: " + error.message);
        } else {
            alert("Email de recuperação enviado! Confere a tua caixa de entrada. ");
        }
    })
}

const resetForm = document.getElementById("reset-password-form");

if (resetForm) {
    resetForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const newPassword = document.getElementById("new-pwd").value;

        const { error } = await supabaseClient.auth.updateUser({
            password: newPassword
        });

        if (error) {
            alert("Erro ao atualizar palavra-passe: " + error.message);
        } else {
            alert("Palavra-passe atualizada com sucesso! Já pode fazer login.");
            window.location.href = 'login.html'
        }
    })
}