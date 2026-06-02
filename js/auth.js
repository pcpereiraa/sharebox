document.getElementById("register-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = document.getElementById("input-name").value;
    const surname = document.getElementById("input-surname").value;
    const email = document.getElementById("input-email").value;
    const tel = document.getElementById("input-tel").value;
    const pwd = document.getElementById("input-pwd").value;
    const pwd2 = document.getElementById("input-pwd2").value;

    // VALIDAÇÃO DE PASSWORDS
    if (pwd !== pwd2) {
        alert("As passwords não batem!");
        return;
    }

    // CRIAÇAO DE CONTA AUTH
    const { data, error} = await supabaseClient.auth.signUp({
        email,
        password: pwd
    });

    if (error) {
        alert(error.message);
        return;
    }

    const userId = data.user.id;

    // CRIAÇAO DE PROFILE
    await supabaseClient.from("profiles").insert([
        {
            id: userId,
            full_name: name + " " + surname,
            username: null,
            avatar_url: null,
            bio: null,
            location: null,
            created_at: new Date()
        }
    ]);

    alert("Conta criada com sucesso!");
    window.location.href = "login.html"
})