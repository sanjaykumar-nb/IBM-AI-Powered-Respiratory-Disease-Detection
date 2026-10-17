import React, { useEffect, useRef } from 'react';

const ParticleLoader = () => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let animationFrameId;
    let particles = [];

    const resizeCanvas = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    class Particle {
      constructor() {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        this.vx = (Math.random() - 0.5) * 1.5;
        this.vy = (Math.random() - 0.5) * 1.5;
        this.size = Math.random() * 2 + 1;
      }

      update() {
        this.x += this.vx;
        this.y += this.vy;

        if (this.x < 0 || this.x > canvas.width) this.vx *= -1;
        if (this.y < 0 || this.y > canvas.height) this.vy *= -1;
      }

      draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = '#8b5cf6'; // Indigo/Violet
        ctx.fill();
      }
    }

    const initParticles = () => {
      const particleCount = Math.min(Math.floor((canvas.width * canvas.height) / 10000), 100);
      particles = [];
      for (let i = 0; i < particleCount; i++) {
        particles.push(new Particle());
      }
    };

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Update and draw particles
      particles.forEach(particle => {
        particle.update();
        particle.draw();
      });

      // Draw connections
      ctx.strokeStyle = 'rgba(139, 92, 246, 0.15)'; // Faint violet
      ctx.lineWidth = 1;
      
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < 100) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }

      animationFrameId = requestAnimationFrame(animate);
    };

    initParticles();
    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <div className="particle-loader-container" style={{
      position: 'relative',
      width: '100%',
      height: '300px',
      background: 'rgba(0,0,0,0.2)',
      borderRadius: '24px',
      overflow: 'hidden',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: '40px'
    }}>
      <canvas 
        ref={canvasRef} 
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%'
        }}
      />
      <div style={{
        position: 'relative',
        zIndex: 10,
        textAlign: 'center',
        background: 'rgba(5, 5, 7, 0.6)',
        backdropFilter: 'blur(8px)',
        padding: '24px 40px',
        borderRadius: '16px',
        border: '1px solid rgba(139, 92, 246, 0.3)'
      }}>
        <div style={{
          width: '40px',
          height: '40px',
          border: '3px solid rgba(139, 92, 246, 0.3)',
          borderTopColor: '#fff',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
          margin: '0 auto 16px'
        }}></div>
        <h3 style={{ color: '#fff', marginBottom: '8px', fontSize: '1.2rem' }}>Analyzing Audio</h3>
        <p style={{ color: '#a5b4fc', fontSize: '0.9rem' }}>AI Model is processing...</p>
      </div>
    </div>
  );
};

export default ParticleLoader;
