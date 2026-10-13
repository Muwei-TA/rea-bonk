

        function getHeavPC(){
            fetch('https://hitbox.io/scripts/playercount.json')
                .then(response => {
                    if (!response.ok) {
                        throw new Error('Hitbox.io playercount fetch failed');
                    }
                    return response.json();
                })
                .then(data => {
                    document.getElementById('header_heav_playercount').textContent = "(" + data.counts.total + " online)";
                })
        }

        getHeavPC();
        setInterval(() => {getHeavPC()}, 90*1000);


		function parseAutojoin(url) {

    		let regex = /\/(\d{6})([a-zA-Z0-9]{5})?$/;
    		let match = url.match(regex);

    		if (match) {

        		let id = match[1];
        		let bypass = match[2] || "";

				let data = new URLSearchParams();
            	data.append('joinID', id);

				fetch('https://bonk2.io/scripts/autojoin.php', {
					method: 'POST',
					headers: {'Content-Type': 'application/x-www-form-urlencoded'},
					body: data.toString(),
				})
				.then(response => response.json())
				.then(result => {
                    if (result.r == "success"){
						result.passbypass = bypass;
                        document.getElementById('maingameframe').contentWindow.autoJoin = result;
                    }
				})
				.catch(error => {
					console.error('Error:', error);
				});
			}
		}

		parseAutojoin( window.location.href );


    